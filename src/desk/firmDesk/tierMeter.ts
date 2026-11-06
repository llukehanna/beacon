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
