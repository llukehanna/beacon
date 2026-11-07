/**
 * What applying market signals writes, as plain data. Pure: no database, no clock. Given the
 * signals that have come due and the firms they name, `planSignals` returns, per signal, the
 * change to the firm, the ResearchFinding that records it, whether the score moved, and whether
 * the firm should be checked for drift. `server/signals/run.ts` performs those writes in one
 * transaction and stamps `appliedAt`.
 *
 * Every signal is synthetic (see shared/marketSignals.ts). How each kind moves the rubric
 * (shared/scoreMirror.ts):
 *
 * A signal only adjusts an axis that already has a value, and never one an analyst has verified
 * since the signal's date: that value outranks the news, the signal is still listed, and nothing
 * moves.
 *
 *   departure          Fee-Generating. A senior fee-earner leaves, so the count falls to
 *                      min(newValue, current): <2 scores 0, 2-3 scores 1, 4 or more scores 2.
 *   senior_hire        Fee-Generating. A senior fee-earner joins: max(newValue, current).
 *   deal_announcement  Deal Size (<$25m 0, $25-150m 1, >$150m 2) or Deals per MD (<1.5 0,
 *                      1.5-3.5 1, >3.5 2): the figure moves to the announced newValue.
 *   acquisition        No rubric axis. A rival buys the firm: the firm's market outcome becomes
 *                      acquired_by_competitor (its source recorded as the market signal) and,
 *                      when the firm is Passed, an outcome_diverged drift event opens ("we passed,
 *                      the market did not") so it resurfaces in Review. On a firm still in the
 *                      pipeline only the outcome is recorded.
 *
 * An axis move writes a ResearchFinding from provider MARKET_SIGNAL with its own status ("signal",
 * never "verified"), no confidence, and the headline as its note. It has no source document and no
 * quote, so no export or tear sheet cites it as a grounded sentence. A signal that changes nothing
 * (skipped, or clamped to the value already on file) writes no finding. When the new value changes
 * the score, the run re-scores through the same rubric, and a qualified or passed firm whose tier
 * moved opens a drift event through the same rule enrichFirm uses (computeDriftForFirm).
 */
import { signalOutranksCheck } from "../../shared/axisState.js";
import { SIGNAL_AXES, isApplied, isSignalKind } from "../../shared/marketSignals.js";
import type { Props } from "../../shared/schema.js";
import { axisPoints, formatAxisValue, scoreFirm } from "../../shared/scoring.js";
import {
  ACQUIRED_BY_COMPETITOR,
  MARKET_SIGNAL,
  PASSED,
  axisByName,
  normalizeLifecycle,
} from "../../shared/vocab.js";

/** A MarketSignal as the apply step reads it (timestamps as ISO strings). */
export interface SignalRow {
  signalId: string;
  firmId: string;
  kind: string;
  effectiveDate: string;
  headline?: string | null;
  axis?: string | null;
  newValue?: string | null;
  appliedAt?: string | null;
}

/** The Firm fields the plan reads. */
export type FirmState = Props<"Firm">;

export type SkipReason =
  | "already_applied"
  | "unknown_firm"
  | "unknown_kind"
  | "unsupported_axis"
  | "bad_value"
  | "no_value"
  | "analyst_newer";

export interface SignalPlan {
  signalId: string;
  firmId: string;
  /** When the run applied the signal: every record it writes carries this time. */
  at: string;
  /** Set when the signal changes nothing and only needs to be marked applied. */
  skipped: SkipReason | null;
  /** "moved" when the signal changed something; "unchanged" when it was applied and changed nothing. */
  effect: "moved" | "unchanged";
  /** Fields to change on the firm; null when none change. */
  firmPatch: Props<"Firm"> | null;
  /** The finding that records the move, without its id; null when the signal moves no axis. */
  finding: Props<"ResearchFinding"> | null;
  /** The firm's score before and after, so the run can tell whether to write a new version. */
  before: { total: number; tier: string };
  after: { total: number; tier: string };
  /** The axis value changed, so a decided firm may have changed tier: compare it with the decision. */
  checkTier: boolean;
  /** An acquisition on a Passed firm: open the outcome_diverged drift event. */
  openOutcomeDrift: boolean;
}

const HIRE_DEPART_AXIS = "fee_generating_count";

/** The signals to apply, oldest first, never more than `limit`; applied and future ones are left out. */
export function dueSignals<T extends SignalRow>(
  signals: readonly T[],
  now: Date,
  limit: number,
): T[] {
  return signals
    .filter((s) => !isApplied(s) && Date.parse(s.effectiveDate) <= now.getTime())
    .sort(
      (a, b) =>
        Date.parse(a.effectiveDate) - Date.parse(b.effectiveDate) ||
        a.signalId.localeCompare(b.signalId),
    )
    .slice(0, limit);
}

const numberOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

interface AxisMove {
  field: string;
  axis: string;
  /** The value the firm field takes. */
  next: number;
  /** The firm's value before the signal; null when none was on file. */
  current: number | null;
}

/** The value a departure, hire or announcement moves an axis to; a reason when it cannot. */
function axisMove(signal: SignalRow, firm: FirmState): AxisMove | SkipReason {
  const axis = (signal.axis ?? "").trim().toLowerCase();
  if (!SIGNAL_AXES[signal.kind as keyof typeof SIGNAL_AXES]?.includes(axis)) {
    return "unsupported_axis";
  }
  const def = axisByName(axis);
  const target = Number(signal.newValue);
  if (def === undefined || signal.newValue === null || signal.newValue === undefined) {
    return "bad_value";
  }
  if (!Number.isFinite(target) || (axis === HIRE_DEPART_AXIS && !Number.isInteger(target))) {
    return "bad_value";
  }
  const current = numberOf((firm as Record<string, unknown>)[def.firmField]);
  let next = target;
  if (signal.kind === "departure" && current !== null) {
    next = Math.min(target, current);
  } else if (signal.kind === "senior_hire" && current !== null) {
    next = Math.max(target, current);
  }
  return { field: def.firmField, axis, next: Math.max(0, next), current };
}

/**
 * Plan the writes for signals, in the order given. `at` says when each is applied (the clock of a
 * live run, or the signal's own date when the seed applies history). Signals on one firm see each
 * other's effect, so two departures in one run take two people off the bench. A signal already
 * marked applied is skipped, which is what makes running the apply step twice change nothing.
 */
export function planSignals(
  signals: readonly SignalRow[],
  firms: ReadonlyMap<string, FirmState>,
  at: (signal: SignalRow) => string,
  /** When an analyst last verified a firm's axis (epoch ms), or null when none has. */
  verifiedAt: (firmId: string, axis: string) => number | null = () => null,
): SignalPlan[] {
  const working = new Map(firms);
  return signals.map((signal): SignalPlan => {
    const base = { signalId: signal.signalId, firmId: signal.firmId, at: at(signal) };
    const firm = working.get(signal.firmId);
    const skip = (skipped: SkipReason, score?: { total: number; tier: string }): SignalPlan => ({
      ...base,
      skipped,
      effect: "unchanged",
      firmPatch: null,
      finding: null,
      before: score ?? { total: 0, tier: "" },
      after: score ?? { total: 0, tier: "" },
      checkTier: false,
      openOutcomeDrift: false,
    });
    if (isApplied(signal)) {
      return skip("already_applied");
    }
    if (firm === undefined) {
      return skip("unknown_firm");
    }
    if (!isSignalKind(signal.kind)) {
      return skip("unknown_kind");
    }
    const beforeScore = scoreFirm(firm);
    const before = { total: beforeScore.weightedTotal, tier: beforeScore.tier };

    if (signal.kind === "acquisition") {
      const firmPatch: Props<"Firm"> = {
        outcome: ACQUIRED_BY_COMPETITOR,
        outcomeObservedAt: signal.effectiveDate,
        outcomeSource: MARKET_SIGNAL,
      };
      working.set(signal.firmId, { ...firm, ...firmPatch });
      return {
        ...base,
        skipped: null,
        effect: "moved",
        firmPatch,
        finding: null,
        before,
        after: before,
        checkTier: false,
        openOutcomeDrift: normalizeLifecycle(firm.lifecycleState) === PASSED,
      };
    }

    const move = axisMove(signal, firm);
    if (typeof move === "string") {
      return skip(move, before);
    }
    // A signal adjusts a value on file; it never fills an empty field.
    if (move.current === null) {
      return skip("no_value", before);
    }
    // An analyst's check made after the news outranks it: the signal is listed, nothing moves.
    // The same rule decides which finding the desk shows (pickAuthoritative).
    if (
      !signalOutranksCheck(Date.parse(signal.effectiveDate), verifiedAt(signal.firmId, move.axis))
    ) {
      return skip("analyst_newer", before);
    }
    // Clamped to the value already on file: applied, but nothing changed and nothing is written.
    if (move.current === move.next) {
      return {
        ...base,
        skipped: null,
        effect: "unchanged",
        firmPatch: null,
        finding: null,
        before,
        after: before,
        checkTier: false,
        openOutcomeDrift: false,
      };
    }
    const def = axisByName(move.axis)!;
    const patch = { [move.field]: move.next } as Props<"Firm">;
    const moved = { ...firm, ...patch };
    const afterScore = scoreFirm(moved);
    working.set(signal.firmId, moved);
    return {
      ...base,
      skipped: null,
      effect: "moved",
      firmPatch: patch,
      finding: {
        firmId: signal.firmId,
        axis: move.axis,
        value: formatAxisValue(move.next),
        normalizedScore: axisPoints(moved, def, move.next),
        provider: MARKET_SIGNAL,
        sourceType: MARKET_SIGNAL,
        // A note, not a quotation: the signal has no source document, so nothing cites it.
        sourceExcerpt: (signal.headline ?? "").trim(),
        // Its own status: "verified" means a person checked the value, and no one has.
        findingStatus: "signal",
        verifiedByHuman: false,
        retrievedAt: base.at,
      },
      before,
      after: { total: afterScore.weightedTotal, tier: afterScore.tier },
      checkTier: true,
      openOutcomeDrift: false,
    };
  });
}
