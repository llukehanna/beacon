import { describe, expect, it } from "vitest";
import { scoreFirm } from "../../shared/scoring.js";
import { STRONG_CF } from "../testing.js";
import { type FirmState, type SignalRow, dueSignals, planSignals } from "./apply.js";

const AT = "2026-09-01T12:00:00.000Z";
const at = (): string => AT;

/** A firm that scores exactly 14 (the floor of tier A): one fee-earner band lower is tier B. */
const FOURTEEN: FirmState = {
  ...STRONG_CF,
  firmId: "f1",
  lifecycleState: "Qualified",
  dealsPerMdL3y: 2, // 1 point
  firmAge: 8, // 1 point
  employees: 50, // 1 point
  geoScore: 1, // 1 point
  feeGeneratingCount: 4, // 2 points
};

const firms = (f: FirmState = FOURTEEN) => new Map([["f1", f]]);

const signal = (over: Partial<SignalRow> & { signalId: string }): SignalRow => ({
  firmId: "f1",
  kind: "departure",
  effectiveDate: "2026-08-30T00:00:00.000Z",
  headline: "Acme loses a partner",
  axis: "fee_generating_count",
  newValue: "3",
  ...over,
});

describe("planSignals", () => {
  it("starts from a firm at the tier A floor", () => {
    expect(scoreFirm(FOURTEEN)).toMatchObject({ weightedTotal: 14, tier: "A" });
  });

  it("a departure lowers the fee-earner count and can move the tier", () => {
    const [plan] = planSignals([signal({ signalId: "s1" })], firms(), at);
    expect(plan.skipped).toBeNull();
    expect(plan.firmPatch).toEqual({ feeGeneratingCount: 3 });
    expect(plan.before).toEqual({ total: 14, tier: "A" });
    expect(plan.after).toEqual({ total: 13, tier: "B" });
    expect(plan.checkTier).toBe(true);
  });

  it("a departure never raises the count, and a hire never lowers it", () => {
    const [departure] = planSignals([signal({ signalId: "s1", newValue: "9" })], firms(), at);
    expect(departure.firmPatch).toBeNull();
    expect(departure.checkTier).toBe(false);
    const [hire] = planSignals(
      [signal({ signalId: "s2", kind: "senior_hire", newValue: "1" })],
      firms(),
      at,
    );
    expect(hire.firmPatch).toBeNull();
    const [raised] = planSignals(
      [signal({ signalId: "s3", kind: "senior_hire", newValue: "6" })],
      firms(),
      at,
    );
    expect(raised.firmPatch).toEqual({ feeGeneratingCount: 6 });
  });

  it("a deal announcement moves deal size or pace to the announced figure", () => {
    const [size] = planSignals(
      [
        signal({
          signalId: "s1",
          kind: "deal_announcement",
          axis: "deal_size_usd_m",
          newValue: "20",
        }),
      ],
      firms(),
      at,
    );
    expect(size.firmPatch).toEqual({ dealSizeMUsd: 20 });
    expect(size.after.total).toBe(size.before.total - 2);
    const [pace] = planSignals(
      [
        signal({
          signalId: "s2",
          kind: "deal_announcement",
          axis: "deals_per_md_l3y",
          newValue: "4.5",
        }),
      ],
      firms(),
      at,
    );
    expect(pace.firmPatch).toEqual({ dealsPerMdL3y: 4.5 });
    expect(pace.after.total).toBe(pace.before.total + 1);
  });

  it("writes a finding that no export or tear sheet can cite as a quotation", () => {
    const [plan] = planSignals([signal({ signalId: "s1" })], firms(), at);
    expect(plan.finding).toMatchObject({
      firmId: "f1",
      axis: "fee_generating_count",
      value: "3",
      provider: "market_signal",
      sourceType: "market_signal",
      sourceExcerpt: "Acme loses a partner",
      findingStatus: "signal",
      verifiedByHuman: false,
      retrievedAt: AT,
    });
    // Never "verified", and never confident: nothing was checked and nothing was read.
    expect(plan.finding?.findingStatus).not.toBe("verified");
    expect(plan.finding?.confidence).toBeUndefined();
    expect(plan.finding?.confidenceTier).toBeUndefined();
    expect(plan.finding?.sourceQuote).toBeUndefined();
    expect(plan.finding?.sourceDocumentId).toBeUndefined();
    expect(plan.finding?.extractionModel).toBeUndefined();
  });

  it("an acquisition records the outcome and reopens a passed firm only", () => {
    const acquisition = signal({
      signalId: "s1",
      kind: "acquisition",
      axis: null,
      newValue: null,
    });
    const [passed] = planSignals(
      [acquisition],
      firms({ ...FOURTEEN, lifecycleState: "Passed" }),
      at,
    );
    expect(passed.openOutcomeDrift).toBe(true);
    expect(passed.firmPatch).toEqual({
      outcome: "acquired_by_competitor",
      outcomeObservedAt: acquisition.effectiveDate,
      outcomeSource: "market_signal",
    });
    expect(passed.finding).toBeNull();
    const [pipeline] = planSignals([acquisition], firms(), at);
    expect(pipeline.openOutcomeDrift).toBe(false);
    expect(pipeline.firmPatch).toMatchObject({ outcome: "acquired_by_competitor" });
  });

  it("signals on one firm see each other, so two departures take two people off the bench", () => {
    const plans = planSignals(
      [
        signal({ signalId: "s1", newValue: "3" }),
        signal({ signalId: "s2", newValue: "1", effectiveDate: "2026-08-31T00:00:00.000Z" }),
      ],
      firms(),
      at,
    );
    expect(plans.map((p) => p.firmPatch)).toEqual([
      { feeGeneratingCount: 3 },
      { feeGeneratingCount: 1 },
    ]);
    expect(plans[1].before.total).toBe(13);
    expect(plans[1].after.total).toBe(12);
  });

  it("never fills an axis with no value on file", () => {
    const [plan] = planSignals(
      [signal({ signalId: "s1", kind: "senior_hire", newValue: "5" })],
      firms({ ...FOURTEEN, feeGeneratingCount: null }),
      at,
    );
    expect(plan).toMatchObject({ skipped: "no_value", effect: "unchanged", firmPatch: null });
    expect(plan.finding).toBeNull();
  });

  it("lets an analyst's later check outrank older news, but not an earlier one", () => {
    const sigDate = Date.parse("2026-08-30T00:00:00.000Z");
    const later = planSignals([signal({ signalId: "s1" })], firms(), at, () => sigDate + 1);
    expect(later[0]).toMatchObject({
      skipped: "analyst_newer",
      effect: "unchanged",
      firmPatch: null,
    });
    expect(later[0].finding).toBeNull();
    expect(later[0].checkTier).toBe(false);
    const earlier = planSignals([signal({ signalId: "s2" })], firms(), at, () => sigDate - 1);
    expect(earlier[0]).toMatchObject({ skipped: null, effect: "moved" });
    const other = planSignals([signal({ signalId: "s3" })], firms(), at, (_f, axis) =>
      axis === "firm_age" ? sigDate + 1 : null,
    );
    expect(other[0].effect).toBe("moved");
  });

  it("writes no finding for a move clamped to the value already on file", () => {
    const [plan] = planSignals([signal({ signalId: "s1", newValue: "9" })], firms(), at);
    expect(plan).toMatchObject({ skipped: null, effect: "unchanged", firmPatch: null });
    expect(plan.finding).toBeNull();
    expect(plan.checkTier).toBe(false);
  });

  it("reports an axis move as moved", () => {
    expect(planSignals([signal({ signalId: "s1" })], firms(), at)[0].effect).toBe("moved");
  });

  it("skips what it cannot apply, and anything already applied", () => {
    const reasons = planSignals(
      [
        signal({ signalId: "applied", appliedAt: AT }),
        signal({ signalId: "ghost", firmId: "nobody" }),
        signal({ signalId: "kind", kind: "rumour" }),
        signal({ signalId: "axis", axis: "firm_age" }),
        signal({ signalId: "value", newValue: "lots" }),
        signal({ signalId: "fraction", newValue: "2.5" }),
      ],
      firms(),
      at,
    ).map((p) => p.skipped);
    expect(reasons).toEqual([
      "already_applied",
      "unknown_firm",
      "unknown_kind",
      "unsupported_axis",
      "bad_value",
      "bad_value",
    ]);
    expect(
      planSignals([signal({ signalId: "x", kind: "rumour" })], firms(), at).map((p) => [
        p.effect,
        p.finding,
      ]),
    ).toEqual([["unchanged", null]]);
  });
});

describe("dueSignals", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const row = (signalId: string, effectiveDate: string, appliedAt?: string): SignalRow =>
    signal({ signalId, effectiveDate, appliedAt });

  it("returns what has come due and is unapplied, oldest first", () => {
    const due = dueSignals(
      [
        row("c", "2026-09-01T11:00:00.000Z"),
        row("future", "2026-09-01T12:00:01.000Z"),
        row("done", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"),
        row("a", "2026-08-31T00:00:00.000Z"),
        row("b", "2026-08-31T00:00:00.000Z"),
      ],
      now,
      10,
    );
    expect(due.map((s) => s.signalId)).toEqual(["a", "b", "c"]);
  });

  it("never returns more than the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      row(`s${String(i).padStart(2, "0")}`, "2026-08-31T00:00:00.000Z"),
    );
    expect(dueSignals(many, now, 10)).toHaveLength(10);
  });
});
