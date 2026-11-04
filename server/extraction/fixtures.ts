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
  if (
    record.output === null ||
    record.firmId !== firmId ||
    record.promptVersion !== EXTRACTION_PROMPT_VERSION ||
    record.documentsHash !== documentsHash(docs)
  ) {
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
