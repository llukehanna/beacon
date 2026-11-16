import { scoreTraits } from "./rubric/engine.js";
import { thesisOf, traitsOf } from "./rubric/firm.js";
import type { RubricDefinition, ScoreResult } from "./rubric/types.js";

type FirmLike = Readonly<Record<string, unknown>>;

/** Score a firm (its thesis and its traits map) under a rubric definition. */
export function scoreFirm(def: RubricDefinition, firm: FirmLike): ScoreResult {
  return scoreTraits(def, thesisOf(firm), traitsOf(firm));
}
