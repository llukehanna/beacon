/**
 * One score scale. The 18-point rubric total is canonical everywhere a score
 * is shown: "13/18 · B". Nothing renders a 0-100 percentage.
 */
import { MAX_POSSIBLE } from "../../shared/scoreMirror";

/** "13/18 · B", "13/18" without a tier, "—/18" when there is no score yet. */
export function formatScore(total: number | null | undefined, tier?: string | null): string {
  const known = typeof total === "number" && Number.isFinite(total);
  const score = `${known ? total : "—"}/${MAX_POSSIBLE}`;
  return tier ? `${score} · ${tier}` : score;
}

/** 0-1 share of the rubric maximum. For bar widths only — never displayed as a number. */
export function scoreFraction(total: number | null | undefined): number {
  if (typeof total !== "number" || !Number.isFinite(total)) {
    return 0;
  }
  return Math.min(1, Math.max(0, total / MAX_POSSIBLE));
}

/** The score a Pipeline row shows: total and tier letter. */
export interface ShownScore {
  total: number;
  tier: string;
}

/** The score stored on the firm's reject decision (ReviewDecision.scoreAtDecision / tierAtDecision). */
export interface DecisionScore {
  scoreAtDecision?: number | null;
  tierAtDecision?: string | null;
}

/**
 * A passed firm shows the score it had when it was passed; every other firm
 * (and a passed firm with no recorded decision score) shows the live score.
 */
export function shownScore(
  live: { weightedTotal: number; tier: string },
  passed: boolean,
  decision: DecisionScore | null | undefined,
): ShownScore {
  const at = decision?.scoreAtDecision;
  const tierAt = decision?.tierAtDecision;
  if (passed && typeof at === "number" && Number.isFinite(at) && tierAt) {
    return { total: at, tier: tierAt };
  }
  return { total: live.weightedTotal, tier: live.tier };
}

/**
 * Tier letter on a queue row. A firm an approved rule screened out reads
 * "Rejected" whatever its score tier; otherwise the score's own tier, so the
 * queue, the desk header and the Pipeline agree.
 */
export function queueRowTier(hardScreened: boolean, tier: string): string {
  return hardScreened ? "Rejected" : tier;
}
