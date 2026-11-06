/**
 * Why axes did not end correct. Pure.
 *
 * A slot (one axis of one firm) ends correct when the agent settled on the true value (the same
 * rule as `matchesTruth`). Every other slot is in exactly one of four kinds, by what the agent
 * recorded:
 *
 * - wrong-source-wins: it settled on one value and that value is wrong. Reconciliation settles
 *   only when the readings it kept agree, so a wrong value reaches the record when a source's
 *   error stands alone or every source repeats it.
 * - conflict-surfaced: it recorded two positions and no winner, so the analyst chooses.
 * - abstained-correctly: it recorded no value and no source's record stated the axis.
 * - abstained-wrongly: it recorded no value although a record stated the axis, so the value was
 *   lost in extraction or grounding.
 *
 * The universe has no time dimension, so there is no "stale value" kind: a source is wrong or
 * right, never out of date.
 */
import type { EvalReport, FailureKind } from "../../shared/evalReport.js";
import { matchesTruth } from "./metrics.js";
import type { FirmEvaluation, SlotResult } from "./pipeline.js";

/** The order the kinds are reported in. */
export const FAILURE_KINDS: readonly FailureKind[] = [
  "wrong-source-wins",
  "conflict-surfaced",
  "abstained-correctly",
  "abstained-wrongly",
];

/** Examples kept per kind: the first slots in firm order, each from a different firm. */
export const MAX_EXAMPLES = 3;

/** The kind of a slot that did not end correct, or null when it did. */
export function classifySlot(slot: SlotResult): FailureKind | null {
  if (slot.plans.length > 1) {
    return "conflict-surfaced";
  }
  const value = slot.plans[0].value;
  if (value === null) {
    return slot.stated.length === 0 ? "abstained-correctly" : "abstained-wrongly";
  }
  return matchesTruth(slot.model, slot.axis, value, slot.truth) ? null : "wrong-source-wins";
}

/** The slots evaluated, how many ended correct, and the rest by kind. */
export function failureTaxonomy(
  evals: readonly FirmEvaluation[],
): Pick<EvalReport, "slots" | "failures"> {
  const failures = FAILURE_KINDS.map((kind) => ({
    kind,
    count: 0,
    examples: [] as { firmId: string; axis: string }[],
  }));
  let total = 0;
  let correct = 0;
  for (const slot of evals.flatMap((e) => e.slots)) {
    total += 1;
    const kind = classifySlot(slot);
    if (kind === null) {
      correct += 1;
      continue;
    }
    const entry = failures[FAILURE_KINDS.indexOf(kind)];
    entry.count += 1;
    if (
      entry.examples.length < MAX_EXAMPLES &&
      !entry.examples.some((e) => e.firmId === slot.firmId)
    ) {
      entry.examples.push({ firmId: slot.firmId, axis: slot.axis.axis });
    }
  }
  return { slots: { total, correct }, failures };
}
