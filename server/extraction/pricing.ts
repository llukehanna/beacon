/**
 * Token prices and cost arithmetic for extraction runs. Pure: no network.
 *
 * Source: the claude-api skill's model table (read 2026-11-04). US$ per million tokens:
 * claude-haiku-4-5 is $1 in / $5 out, claude-sonnet-5-5 is $2 in / $10 out. Cache reads are
 * 0.1x the input price and 5-minute cache writes 1.25x. The Batch API takes 50% off every
 * token, cache reads and writes included.
 *
 * `minCacheableTokens` is the shortest prompt prefix the model will cache; a shorter one
 * silently does not cache even with a cache_control marker (4096 for Haiku 4.5; 512 for
 * Sonnet 5.5, a newer model whose value the skill says to confirm in the prompt-caching docs).
 */
import type { FixtureRecord } from "./fixtures.js";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  minCacheableTokens: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    minCacheableTokens: 4096,
  },
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    minCacheableTokens: 512,
  },
};

const BATCH_FACTOR = 0.5;
const CHARS_PER_TOKEN = 4;
/** Planning figure for a reply: the shape is a short JSON list, well under max_tokens. */
const OUTPUT_TOKENS_PER_FIRM = 600;

function priceOf(model: string): ModelPrice {
  const price = PRICES[model];
  if (!price) {
    throw new Error(
      `No price for model "${model}". Add it to PRICES in server/extraction/pricing.ts.`,
    );
  }
  return price;
}

/** Dollars for one request's reported usage. */
export function costFromUsage(
  model: string,
  usage: FixtureRecord["usage"],
  batch: boolean,
): number {
  const p = priceOf(model);
  const dollars =
    (usage.inputTokens * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok +
      usage.cacheReadTokens * p.cacheReadPerMTok +
      usage.cacheWriteTokens * p.cacheWritePerMTok) /
    1_000_000;
  return batch ? dollars * BATCH_FACTOR : dollars;
}

/** Whether a system prompt of this many characters is long enough for the model to cache it. */
export function systemPromptCaches(model: string, systemChars: number): boolean {
  return Math.ceil(systemChars / CHARS_PER_TOKEN) >= priceOf(model).minCacheableTokens;
}

/**
 * A planning estimate for one firm: 4 characters per token and 600 output tokens. The system
 * prompt is priced as a cache read (every firm after the first) only when it is long enough to
 * cache; otherwise it is full-price input, so a short prompt never earns a discount it will not get.
 */
export function estimateFirmCostUsd(
  model: string,
  userMessageChars: number,
  systemChars: number,
  batch: boolean,
): number {
  const p = priceOf(model);
  const userTokens = Math.ceil(userMessageChars / CHARS_PER_TOKEN);
  const systemTokens = Math.ceil(systemChars / CHARS_PER_TOKEN);
  const systemRate = systemPromptCaches(model, systemChars) ? p.cacheReadPerMTok : p.inputPerMTok;
  const dollars =
    (userTokens * p.inputPerMTok +
      systemTokens * systemRate +
      OUTPUT_TOKENS_PER_FIRM * p.outputPerMTok) /
    1_000_000;
  return batch ? dollars * BATCH_FACTOR : dollars;
}
