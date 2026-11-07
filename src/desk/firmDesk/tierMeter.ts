/** Geometry of the score box's tier meter: where each tier sits on the bar and where the score falls. */

export type MeterTier = "Rejected" | "C" | "B" | "A";

export interface TierMeterModel {
  /** Fractions of the maximum, contiguous, from 0 to 1. */
  segments: { tier: MeterTier; from: number; to: number }[];
  /** score / max, clamped to [0, 1]. */
  pin: number;
  /** prior / max; null when there is no prior score or it equals the score. */
  ghost: number | null;
  tier: MeterTier;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * `cuts` are the rubric's tier thresholds (shared/scoreMirror TIER_THRESHOLDS): the lowest total
 * that earns C, B and A. Below C is Rejected. The tier is the one the cuts give the score, so it
 * agrees with the rubric.
 */
export function tierMeter(
  score: number,
  max: number,
  cuts: { C: number; B: number; A: number },
  prior?: number | null,
): TierMeterModel {
  const share = (n: number): number => clamp01(n / max);
  const segments: TierMeterModel["segments"] = [
    { tier: "Rejected", from: 0, to: share(cuts.C) },
    { tier: "C", from: share(cuts.C), to: share(cuts.B) },
    { tier: "B", from: share(cuts.B), to: share(cuts.A) },
    { tier: "A", from: share(cuts.A), to: 1 },
  ];
  const tier: MeterTier =
    score >= cuts.A ? "A" : score >= cuts.B ? "B" : score >= cuts.C ? "C" : "Rejected";
  const ghost =
    typeof prior === "number" && Number.isFinite(prior) && prior !== score ? share(prior) : null;
  return { segments, pin: share(score), ghost, tier };
}

/**
 * The tier as the score box words it: "Tier B", or for a total under the C cut-off "Rejected"
 * when the firm is hard-screened and "Below C" when it is only a low score (enrichment can still
 * move that).
 */
export function tierText(tier: MeterTier, hardScreened: boolean): string {
  if (tier !== "Rejected") {
    return `Tier ${tier}`;
  }
  return hardScreened ? "Rejected" : "Below C";
}

/** The lowest meter segment's label follows the same rule; the others are their tier letter. */
export function segmentLabel(tier: MeterTier, hardScreened: boolean): string {
  return tier === "Rejected" ? tierText(tier, hardScreened) : tier;
}

/**
 * What "Below C" means, for a tooltip: the score is under the model's C cut-off, so the firm has
 * no tier yet. Enrichment can still raise it. Null for any other tier.
 */
export function belowCGloss(
  tier: MeterTier,
  hardScreened: boolean,
  cutC: number,
  max: number,
): string | null {
  return tier === "Rejected" && !hardScreened
    ? `Below C: under ${cutC} of ${max} points, the lowest score that earns a C. Enrichment can still raise it.`
    : null;
}
