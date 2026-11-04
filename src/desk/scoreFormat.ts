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
