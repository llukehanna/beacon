/**
 * The rejections the seed plants for the learning loop to find: how many of each kind, the words
 * the analyst gives, and the values it records. Pure, so the seed and the evaluation plant the
 * same patterns from the same definitions.
 */
import type { Rng } from "../enrichment/random.js";

/** Rejections the seed makes per pattern; `misc` is noise no hard-screen rule can express. */
export const REJECTION_COUNTS = {
  small: 7,
  generalist: 5,
  dealSize: 5,
  dealVolume: 4,
  misc: 4,
} as const;

export const smallFirmRationale = (employees: number | undefined): string =>
  `Too small — ${employees} staff; can't absorb an integration.`;

export const GENERALIST_RATIONALE =
  "Generalist coverage with no sector depth; unfocused franchise.";

export const dealSizeRationale = (sizeMUsd: number): string =>
  `Deal size around $${sizeMUsd}m is below our floor; small deals.`;

export const DEAL_VOLUME_RATIONALE =
  "Too few deals per MD over the last three years; weak deal volume.";

export const MISC_RATIONALE = "Weak MD experience for our franchise.";

/** The deal size ($m) the analyst records before rejecting a firm for small deals. One draw. */
export const plantedDealSize = (r: Rng): number => 8 + Math.round(r() * 18);

/** The deals per MD the analyst records before rejecting a firm for weak volume. One draw. */
export const plantedDealVolume = (r: Rng): number => Math.round(r() * 15) / 10;
