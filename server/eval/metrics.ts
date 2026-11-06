/**
 * The measures, all against the synthetic universe's hidden truth (`truthFor`). Pure.
 *
 * A "slot" is one axis of one firm, among the axes the firm's model enriches.
 *
 * Correct. A kept value is correct when it matches the truth under the rubric's own banding:
 * a numeric value is correct when it falls in the same rubric band as the truth (so 140 and 60
 * both read as "$25m-$150m" deal size), a categorical or true/false value only when it is the
 * same label. Banding means a numeric figure that is off but lands in the truth's band counts as
 * right, because the score it earns is the same.
 *
 * Provider coverage / precision. Over the slots whose axis the provider covers: coverage is the
 * share with a grounded reading from that provider; precision is the share of those readings that
 * are correct.
 *
 * Reconciled. A slot is settled when the agent records one value, abstained when it records none,
 * and in conflict when two positions disagree (it never picks a winner). Coverage is settled slots
 * over all slots; precision is correct settled values over settled slots; conflict rate is
 * conflicted slots over slots with any reading; "higher-trust right" is the share of conflicted
 * slots where the more trusted position is correct.
 *
 * Abstention. Rate is abstained slots over all slots. Calibration is the share of abstentions where
 * no provider's record stated the axis (an abstention is right when nobody had the value, wrong
 * when a record had it and extraction or grounding lost it).
 *
 * Tier agreement. The share of firms whose tier from the agent's settled values equals the tier
 * from the true values.
 */
import type { EvalReport } from "../../shared/evalReport.js";
import type { Model } from "../../shared/scoreMirror.js";
import { axisPoints, parseAxisValue } from "../../shared/scoring.js";
import { type AxisDef, PROVIDER_TRUST } from "../../shared/vocab.js";
import { PROVIDERS } from "../enrichment/providers.js";
import { sameValue } from "../enrichment/reconcile.js";
import type { FirmEvaluation, SlotResult } from "./pipeline.js";

/** num / den to four places, or null when there is nothing to divide by. */
export function rate(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 10_000) / 10_000;
}

/** Whether a value matches the truth under the rule at the top of this file. */
export function matchesTruth(model: Model, axis: AxisDef, value: string, truth: string): boolean {
  if (axis.kind !== "number") {
    return sameValue(axis, value, truth);
  }
  const firm = { firmType: model };
  const a = axisPoints(firm, axis, parseAxisValue(axis, value));
  const b = axisPoints(firm, axis, parseAxisValue(axis, truth));
  return a !== null && b !== null ? a === b : sameValue(axis, value, truth);
}

type Measured = Pick<
  EvalReport,
  "firms" | "providers" | "reconciled" | "abstention" | "tierAgreement"
>;

const isSettled = (s: SlotResult): boolean => s.plans.length === 1 && s.plans[0].value !== null;
const isAbstained = (s: SlotResult): boolean => s.plans.length === 1 && s.plans[0].value === null;
const isConflict = (s: SlotResult): boolean => s.plans.length > 1;

export function computeMetrics(evals: readonly FirmEvaluation[]): Measured {
  const slots = evals.flatMap((e) => e.slots);

  const providers = PROVIDER_TRUST.map((provider) => {
    const covered = slots.filter((s) => PROVIDERS[provider].axes.includes(s.axis.axis));
    const readings = covered.flatMap((s) => {
      const k = s.kept.find((x) => x.provider === provider);
      return k ? [{ slot: s, value: k.value }] : [];
    });
    const correct = readings.filter((r) =>
      matchesTruth(r.slot.model, r.slot.axis, r.value, r.slot.truth),
    );
    return {
      provider,
      coverage: rate(readings.length, covered.length),
      precision: rate(correct.length, readings.length),
    };
  });

  const settled = slots.filter(isSettled);
  const settledCorrect = settled.filter((s) =>
    matchesTruth(s.model, s.axis, s.plans[0].value ?? "", s.truth),
  );
  const conflicts = slots.filter(isConflict);
  const leadRight = conflicts.filter((s) =>
    matchesTruth(s.model, s.axis, s.plans[0].value ?? "", s.truth),
  );
  const abstained = slots.filter(isAbstained);
  const justified = abstained.filter((s) => s.stated.length === 0);

  return {
    firms: evals.length,
    providers,
    reconciled: {
      coverage: rate(settled.length, slots.length),
      precision: rate(settledCorrect.length, settled.length),
      conflictRate: rate(conflicts.length, slots.length - abstained.length),
      higherTrustRight: rate(leadRight.length, conflicts.length),
    },
    abstention: {
      rate: rate(abstained.length, slots.length),
      calibration: rate(justified.length, abstained.length),
    },
    tierAgreement: rate(evals.filter((e) => e.agentTier === e.truthTier).length, evals.length),
  };
}
