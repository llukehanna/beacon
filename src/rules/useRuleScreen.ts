import React from "react";
import {
  type ScreenableFirm,
  countScreened,
  isEvaluable,
  toScreeningRules,
} from "@/desk/activeScreening";
import { mirrorScore } from "@/desk/scoreMirror";
import { type FirmView, toScoreInput } from "../../shared/deskModel";
import { isOpenFirm } from "../../shared/pipelineBuckets";
import { firmFieldFor } from "../../shared/queue";
import { type RuleLike, type RuleVersions } from "./rulesModel";

export interface RuleScreen {
  /** Firms the rule's effective predicate takes off the desk queue; null when it cannot be counted here. */
  projected: number | null;
  /**
   * Of those, the firms still open: undecided in the funnel and not already rejected by the
   * rubric. This is the desk sidebar's "open firms screened by approved rules" for this rule, so
   * the two counts can sit side by side. Null whenever `projected` is.
   */
  projectedOpen: number | null;
  /** True for a predicate this page cannot count (a text rule), as opposed to a count of zero. */
  unavailable: boolean;
  /** The uncountable rule is on a resolvable axis, so the queue's own matcher still applies it. */
  textRule: boolean;
}

/**
 * How many firms a rule screens, computed live from the same firm set and evaluator the desk
 * partitions on, at the rule's effective predicate. The server's projectedScreenCount is a
 * snapshot from when the rule was drafted; trusting it is what once let a card claim "would screen
 * 160 firms" while the desk read "711 of 711". Null means "cannot count here", never "zero".
 */
export function useRuleScreen(
  rule: RuleLike,
  versions: RuleVersions,
  firms: readonly (ScreenableFirm & FirmView)[],
): RuleScreen {
  const effective = versions.activeLatest;
  const screenRules = React.useMemo(
    () =>
      toScreeningRules(
        [
          {
            proposedRuleId: rule.proposedRuleId,
            // Force-approved: the count is for what this predicate would do, approved or not.
            ruleStatus: "approved",
            predicateAxis: effective?.configAxis ?? rule.predicateAxis,
            ruleOperator: effective?.configOperator ?? rule.ruleOperator,
            ruleThreshold: effective?.configThreshold ?? rule.ruleThreshold,
            ruleModel: rule.ruleModel,
          },
        ],
        // The effective predicate is already resolved above, so there is no overlay to apply.
        [],
      ),
    [rule, effective],
  );
  const first = screenRules[0];
  const unavailable = first !== undefined && !isEvaluable(first);
  const countable = first !== undefined && !unavailable;
  const projectedOpen = React.useMemo(
    () =>
      countable
        ? countScreened(
            firms.filter((f) => isOpenFirm(f, mirrorScore(toScoreInput(f)).hardRejected)),
            screenRules,
          )
        : null,
    [countable, firms, screenRules],
  );
  return {
    projected: countable ? countScreened(firms, screenRules) : null,
    projectedOpen,
    unavailable,
    // A rule on a resolvable axis with a string operator (=, in, contains) is matched by the
    // queue's own matcher even though this page cannot count it.
    textRule: unavailable && firmFieldFor(first.axis) !== null,
  };
}
