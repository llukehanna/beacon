import { evalCount, evalPct } from "../accuracy/evalsModel";

export interface GroundingCard {
  /** The pass rate as a percentage with one decimal, "99.7". */
  value: string;
  /** "of 6,472 extracted values passed grounding · 17 dropped". */
  meaning: string;
}

/**
 * The grounding card's figures, from the recorded extraction run: every value the model returned,
 * including the ones the check threw away. Counting only the values that survived would read 100%
 * by construction. Null when the run holds no values.
 */
export function groundingCard(run: { values: number; grounded: number }): GroundingCard | null {
  if (run.values <= 0) {
    return null;
  }
  const dropped = run.values - run.grounded;
  return {
    value: evalPct(run.grounded / run.values),
    meaning: `of ${evalCount(run.values)} extracted values passed grounding · ${evalCount(dropped)} dropped`,
  };
}
