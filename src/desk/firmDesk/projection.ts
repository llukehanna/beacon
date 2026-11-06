/**
 * The score a firm would have if its open proposals were verified. Uses the same rubric mirror
 * the header uses for staged edits, so the two cannot disagree.
 */
import { FINDING_AXIS_TO_KEY, coerceFindingValue } from "../findingActions";
import { type ScoreInput, type Tier, mirrorScore } from "../scoreMirror";
import { type AxisRow, authoritativeFinding } from "./axisRows";
import { type EditMap, buildMerged } from "./deskModel";

export interface Projection {
  score: number;
  tier: Tier;
  hardRejected: boolean;
  /** How many open proposals went into it. */
  count: number;
}

/**
 * `base` is the firm as stored and `edits` what the analyst has staged; staged values win over a
 * proposal for the same axis. Null when no proposal is open. Conflicts and abstentions are left
 * out: they have no single value to project.
 */
export function projectProposals(
  base: ScoreInput,
  edits: EditMap,
  rows: readonly AxisRow[],
): Projection | null {
  const proposed: EditMap = {};
  for (const row of rows) {
    if (row.state !== "proposed") {
      continue;
    }
    const f = authoritativeFinding(row);
    const key = FINDING_AXIS_TO_KEY[(f?.axis ?? "").trim().toLowerCase()];
    if (f === undefined || key === undefined || edits[key] !== undefined) {
      continue;
    }
    const value = coerceFindingValue(key, f.value);
    if (value !== undefined) {
      proposed[key] = value;
    }
  }
  const count = Object.keys(proposed).length;
  if (count === 0) {
    return null;
  }
  const result = mirrorScore(buildMerged(base, { ...edits, ...proposed }));
  return {
    score: result.weightedTotal,
    tier: result.tier,
    hardRejected: result.hardRejected,
    count,
  };
}
