/**
 * Which firms to extract and how to spread them over batches without passing a dollar cap.
 * Pure: no DB, network, or filesystem.
 */
import { EXTRACTION_PROMPT_VERSION } from "./contract.js";
import type { FixtureRecord } from "./fixtures.js";

/**
 * The firms still to extract, in firmId order. A firm is done when a record exists for the same
 * model, prompt version, and document hash; one made against older text is picked again.
 * `sample` keeps only the first N of what is left.
 */
export function selectFirmsToExtract(
  firmIds: readonly string[],
  existing: readonly FixtureRecord[],
  opts: { model: string; sample?: number; hashes: Map<string, string> },
): string[] {
  const done = new Set(
    existing
      .filter(
        (r) =>
          r.model === opts.model &&
          r.promptVersion === EXTRACTION_PROMPT_VERSION &&
          r.documentsHash === opts.hashes.get(r.firmId),
      )
      .map((r) => r.firmId),
  );
  const todo = [...firmIds].sort().filter((id) => !done.has(id));
  return opts.sample === undefined ? todo : todo.slice(0, opts.sample);
}

/** Dollars are summed in millionths so a total that lands exactly on the cap is not lost to float error. */
const micro = (usd: number): number => Math.round(usd * 1_000_000);

/**
 * Take firms in order while the running total (`spentUsd` plus the estimates so far) stays within
 * `maxUsd`, stopping at the first firm that would push past it. The planned firms are cut into
 * chunks of `chunkSize`; the rest are counted as skipped.
 */
export function planChunks(
  firmIds: readonly string[],
  estimateUsd: (id: string) => number,
  maxUsd: number,
  spentUsd: number,
  chunkSize: number,
): { chunks: string[][]; skippedForBudget: number } {
  const cap = micro(maxUsd);
  let total = micro(spentUsd);
  const planned: string[] = [];
  for (const id of firmIds) {
    total += micro(estimateUsd(id));
    if (total > cap) {
      break;
    }
    planned.push(id);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < planned.length; i += chunkSize) {
    chunks.push(planned.slice(i, i + chunkSize));
  }
  return { chunks, skippedForBudget: firmIds.length - planned.length };
}

const VALID_CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Batch request ids, as a map from custom_id to firmId. The API accepts 1 to 64 letters, digits,
 * underscores, and hyphens; a firmId that does not fit is given a deterministic stand-in
 * ("f0", "f1", ... in sorted order), kept only for the run.
 */
export function assignCustomIds(firmIds: readonly string[]): Map<string, string> {
  const sorted = [...firmIds].sort();
  const ids = new Map<string, string>();
  for (const firmId of sorted) {
    if (VALID_CUSTOM_ID.test(firmId)) {
      ids.set(firmId, firmId);
    }
  }
  let n = 0;
  for (const firmId of sorted) {
    if (!VALID_CUSTOM_ID.test(firmId)) {
      let candidate = `f${n++}`;
      while (ids.has(candidate)) {
        candidate = `f${n++}`;
      }
      ids.set(candidate, firmId);
    }
  }
  return ids;
}
