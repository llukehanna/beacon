/**
 * Extraction fixtures: one JSONL line per firm per model, written offline by
 * `npm run extract` and loaded by the seed. Pure: no DB, network, or filesystem.
 */
import { z } from "zod";
import type { Props } from "../../shared/schema.js";
import { PROVIDER_TRUST, type Provider } from "../../shared/vocab.js";
import { type FirmRef, idOf } from "../enrichment/providers.js";
import { EXTRACTION_PROMPT_VERSION, type ExtractionOutput } from "./contract.js";
import { documentsHash, firmDocuments } from "./documents.js";
import { groundExtraction } from "./grounding.js";

export interface FixtureRecord {
  firmId: string;
  model: string;
  promptVersion: string;
  documentsHash: string;
  createdAt: string;
  /** Null when the reply was not usable JSON; the firm then falls back to rule-based extraction. */
  output: ExtractionOutput | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  costUsd: number;
  /** Only measured by `--sync`; a batch has no per-request latency. */
  latencyMs: number | null;
  batchId: string | null;
}

const PROVIDERS: ReadonlySet<string> = new Set(PROVIDER_TRUST);
const tokens = z.number().int().nonnegative();
const nullableText = z.string().nullable();

const recordSchema = z.object({
  firmId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string(),
  documentsHash: z.string(),
  createdAt: z.string(),
  output: z
    .object({
      items: z.array(
        z.object({
          provider: z.string().refine((p): p is Provider => PROVIDERS.has(p)),
          axis: z.string(),
          value: nullableText,
          quote: nullableText,
        }),
      ),
    })
    .nullable(),
  usage: z.object({
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: tokens,
    cacheWriteTokens: tokens,
  }),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative().nullable(),
  batchId: z.string().nullable(),
});

/** Records from JSONL text. Blank lines and lines that are not a valid record are skipped. */
export function parseFixtureLines(text: string): FixtureRecord[] {
  const records: FixtureRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = recordSchema.safeParse(json);
    if (parsed.success) {
      records.push(parsed.data);
    }
  }
  return records;
}

/**
 * How to make fixture text safe to append to, without rewriting it. A run killed mid-write can
 * leave a last line with no newline: if it is a whole record, append the newline; if it is a
 * fragment, truncate the file to `keepBytes`, the byte length of everything up to the last newline.
 */
export function planFixtureRepair(text: string): {
  addNewline: boolean;
  keepBytes: number | null;
} {
  if (text === "" || text.endsWith("\n")) {
    return { addNewline: false, keepBytes: null };
  }
  const cut = text.lastIndexOf("\n") + 1;
  if (parseFixtureLines(text.slice(cut)).length > 0) {
    return { addNewline: true, keepBytes: null };
  }
  return { addNewline: false, keepBytes: new TextEncoder().encode(text.slice(0, cut)).length };
}

/**
 * Where a record stands against the current code. `unusable`: the reply was not usable JSON.
 * `stale`: made for another firm, prompt version, or document text, so its quotes must not be
 * trusted. `current`: the seed turns it into rows.
 */
export type FixtureStatus = "current" | "stale" | "unusable";

export function fixtureStatus(record: FixtureRecord, firm: FirmRef | undefined): FixtureStatus {
  if (record.output === null) {
    return "unusable";
  }
  if (
    firm === undefined ||
    record.firmId !== idOf(firm) ||
    record.promptVersion !== EXTRACTION_PROMPT_VERSION ||
    record.documentsHash !== documentsHash(firmDocuments(firm))
  ) {
    return "stale";
  }
  return "current";
}

/** How many of `records` are current, stale, or unusable; `firms` are looked up by id. */
export function summarizeFixtures(
  records: readonly FixtureRecord[],
  firms: ReadonlyMap<string, FirmRef>,
): Record<FixtureStatus, number> {
  const counts: Record<FixtureStatus, number> = { current: 0, stale: 0, unusable: 0 };
  for (const record of records) {
    counts[fixtureStatus(record, firms.get(record.firmId))]++;
  }
  return counts;
}

/**
 * The model of the newest record (the newest model file), and the firms with no current record
 * from it. `model` is null when there are no records at all.
 */
export function firmsMissingCurrent(
  records: readonly FixtureRecord[],
  firms: readonly FirmRef[],
): { model: string | null; missing: string[] } {
  let newest: FixtureRecord | undefined;
  for (const record of records) {
    if (newest === undefined || record.createdAt > newest.createdAt) {
      newest = record;
    }
  }
  if (newest === undefined) {
    return { model: null, missing: [] };
  }
  const model = newest.model;
  const byFirm = new Map(firms.map((f) => [idOf(f), f]));
  const done = new Set(
    records
      .filter((r) => r.model === model && fixtureStatus(r, byFirm.get(r.firmId)) === "current")
      .map((r) => r.firmId),
  );
  return { model, missing: [...byFirm.keys()].filter((id) => !done.has(id)).sort() };
}

/**
 * The `Extraction` rows for one record, one per item with a value, each marked grounded or
 * rejected by the same check the agent applies. A record is ignored (no rows) when its reply
 * was unusable, or when it was made against other document text or another prompt version:
 * a quote from older text must never reach the database.
 */
export function fixtureToExtractionRows(
  record: FixtureRecord,
  firm: FirmRef,
  now: Date,
): Props<"Extraction">[] {
  const firmId = idOf(firm);
  const docs = firmDocuments(firm);
  if (record.output === null || fixtureStatus(record, firm) !== "current") {
    return [];
  }
  // One row per (provider, axis): the primary key allows no more. A grounded item beats a rejected one.
  const rows = new Map<string, Props<"Extraction">>();
  for (const item of record.output.items) {
    if (item.value === null) {
      continue;
    }
    const result = groundExtraction(firm, docs, { items: [item] }, record.model);
    const grounded = result.observations.length > 0;
    const key = `${item.provider}|${item.axis}`;
    if (rows.has(key) && (!grounded || rows.get(key)?.grounded)) {
      continue;
    }
    rows.set(key, {
      extractionId: `${firmId}|${record.model}|${item.provider}|${item.axis}`,
      firmId,
      provider: item.provider,
      axis: item.axis,
      value: item.value,
      quote: item.quote,
      model: record.model,
      promptVersion: record.promptVersion,
      documentsHash: record.documentsHash,
      grounded,
      rejectReason: grounded ? null : (result.rejected[0]?.reason ?? null),
      extractedAt: now.toISOString(),
    });
  }
  return [...rows.values()];
}
