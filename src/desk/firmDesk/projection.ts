/**
 * The score a firm would have if its open proposals were verified. Uses the same preview score
 * the header uses for staged edits, so the two cannot disagree.
 */
import type { RubricContext, Tier } from "../../../shared/rubric/types";
import { coerceFindingValue, traitOfAxis } from "../findingActions";
import { type AxisRow, authoritativeFinding } from "./axisRows";
import { type EditMap, type FirmView, previewScore } from "./deskModel";

export interface Projection {
  score: number;
  tier: Tier;
  hardRejected: boolean;
  /** Why the rubric would hard-reject the firm on these values; empty when it would not. */
  rejectReason: string;
  /** How many open proposals went into it. */
  count: number;
}

/**
 * `base` is the firm as stored and `edits` what the analyst has staged; staged values win over a
 * proposal for the same axis. Null when no proposal is open. Conflicts and abstentions are left
 * out: they have no single value to project.
 */
export function projectProposals(
  rubric: RubricContext,
  base: FirmView,
  edits: EditMap,
  rows: readonly AxisRow[],
): Projection | null {
  const proposed: EditMap = {};
  for (const row of rows) {
    if (row.state !== "proposed") {
      continue;
    }
    const f = authoritativeFinding(row);
    const key = traitOfAxis(rubric, f?.axis)?.traitKey;
    if (f === undefined || key === undefined || edits[key] !== undefined) {
      continue;
    }
    const value = coerceFindingValue(rubric, key, f.value);
    if (value !== undefined) {
      proposed[key] = value;
    }
  }
  const count = Object.keys(proposed).length;
  if (count === 0) {
    return null;
  }
  const result = previewScore(rubric, base, { ...edits, ...proposed });
  return {
    score: result.weightedTotal,
    tier: result.tier,
    hardRejected: result.hardRejected,
    rejectReason: result.rejectReason,
    count,
  };
}
