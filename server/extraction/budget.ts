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
/** Estimates round up, so rounding can only make a plan more conservative. */
const microUp = (usd: number): number => Math.ceil(Math.round(usd * 1e9) / 1000);

/** The first chunk of a run is small, so a bad estimate shows up before much is spent. */
export const FIRST_CHUNK_MAX = 20;

/**
 * Take firms in order while the running total (`spentUsd` plus the estimates so far) stays within
 * `maxUsd`, stopping at the first firm that would push past it. The planned firms are cut into
 * chunks of `chunkSize` (the first chunk takes `firstChunkSize`, default the same); the rest are
 * counted as skipped. An estimate that is not a finite number is an error: it would otherwise
 * compare as "within the cap" and plan everything.
 */
export function planChunks(
  firmIds: readonly string[],
  estimateUsd: (id: string) => number,
  maxUsd: number,
  spentUsd: number,
  chunkSize: number,
  firstChunkSize: number = chunkSize,
): { chunks: string[][]; skippedForBudget: number } {
  const cap = micro(maxUsd);
  let total = micro(spentUsd);
  const planned: string[] = [];
  for (const id of firmIds) {
    const estimate = estimateUsd(id);
    if (!Number.isFinite(estimate) || estimate < 0) {
      throw new Error(`Cost estimate for ${id} is not a usable number (${estimate}).`);
    }
    total += microUp(estimate);
    if (total > cap) {
      break;
    }
    planned.push(id);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < planned.length;) {
    const size = chunks.length === 0 ? firstChunkSize : chunkSize;
    chunks.push(planned.slice(i, i + size));
    i += size;
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

/**
 * Run `fn`, retrying errors `isTransient` accepts with exponential backoff (1s, 2s, 4s, ... up to
 * 60s). Gives up after `attempts` tries and throws the last error; other errors throw at once.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    isTransient: (err: unknown) => boolean;
    attempts?: number;
    baseMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !opts.isTransient(err)) {
        throw err;
      }
      await sleep(Math.min(baseMs * 2 ** (attempt - 1), 60_000));
    }
  }
}
