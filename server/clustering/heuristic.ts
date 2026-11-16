/**
 * Deterministic clustering: a fixed set of candidate predicates, each
 * supported by rejections whose rationale mentions it AND whose firm
 * actually satisfies it. Used by the seed, in tests, and whenever Claude
 * is off, throttled, or unavailable.
 */
import { matchesPredicate } from "../../shared/predicate.js";
import type { Clusterer, RuleProposal } from "./types.js";

export const heuristicClusterer: Clusterer = async (rows, rubric) => {
  const proposals: RuleProposal[] = rubric.definition.candidateScreens
    .map((c) => ({
      predicateAxis: c.axis,
      ruleOperator: c.operator,
      ruleThreshold: c.threshold,
      ruleModel: "both" as const,
      summary: c.summary,
      supportingDecisionIds: rows
        .filter(
          (r) =>
            new RegExp(c.keywords, "i").test(r.rationale) &&
            matchesPredicate(r.firm, {
              axis: c.axis,
              operator: c.operator,
              threshold: c.threshold,
            }),
        )
        .map((r) => r.decisionId),
    }))
    .filter((p) => p.supportingDecisionIds.length > 0);
  return { proposals, source: "heuristic" };
};
