/** One rejection the clusterer may group: the analyst's words plus the firm's facts. */
import type { RubricContext } from "../../shared/rubric/types.js";

export interface RejectionRow {
  decisionId: string;
  firmId: string;
  rationale: string;
  firm: Readonly<Record<string, unknown>>;
}

/** A candidate hard-screen rule. The action validates every field before persisting. */
export interface RuleProposal {
  predicateAxis: string;
  ruleOperator: string;
  ruleThreshold: string;
  /** A thesis key, or "both" for every thesis. */
  ruleModel: string;
  summary: string;
  supportingDecisionIds: string[];
}

export type Clusterer = (
  rows: readonly RejectionRow[],
  rubric: RubricContext,
) => Promise<{ proposals: RuleProposal[]; source: "claude" | "heuristic" }>;
