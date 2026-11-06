import { describe, expect, it } from "vitest";
import { axisByName } from "../../shared/vocab.js";
import type { FindingPlan } from "../enrichment/reconcile.js";
import { computeMetrics, matchesTruth, rate } from "./metrics.js";
import type { FirmEvaluation, SlotResult } from "./pipeline.js";

const dealSize = axisByName("deal_size_usd_m")!;
const services = axisByName("services_fit")!;
const solvent = axisByName("solvent")!;

const plan = (value: string | null, conflictGroupId: string | null = null): FindingPlan => ({
  axis: "x",
  value,
  provider: "dealdb",
  sourceType: "database",
  sourceUrl: null,
  sourceExcerpt: "",
  sourceDocumentId: null,
  sourceQuote: null,
  extractionModel: null,
  confidence: value === null ? 0 : 0.9,
  confidenceTier: value === null ? "abstain" : "high",
  findingStatus: value === null ? "abstained" : "proposed",
  conflictGroupId,
});

const slot = (over: Partial<SlotResult>): SlotResult => ({
  firmId: "f",
  model: "CF",
  axis: dealSize,
  truth: "60",
  stated: [],
  kept: [],
  plans: [plan(null)],
  ...over,
});

const firmEval = (slots: SlotResult[], over: Partial<FirmEvaluation> = {}): FirmEvaluation => ({
  firmId: "f",
  model: "CF",
  extractionModel: "rule-based",
  slots,
  truthTier: "B",
  agentTier: "B",
  ...over,
});

describe("rate", () => {
  it("is null when the denominator is 0", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
});

describe("computeMetrics", () => {
  it("reports null rates when there is nothing to measure", () => {
    const m = computeMetrics([]);
    expect(m.firms).toBe(0);
    expect(m.reconciled).toEqual({
      coverage: null,
      precision: null,
      conflictRate: null,
      higherTrustRight: null,
    });
    expect(m.abstention).toEqual({ rate: null, calibration: null });
    expect(m.tierAgreement).toBeNull();
    expect(m.providers.every((p) => p.coverage === null && p.precision === null)).toBe(true);
  });

  it("counts a kept value as correct only when it matches truth under the documented rule", () => {
    // Numbers: the same rubric band is correct (60 and 140 are both $25m-$150m); enums: exact.
    expect(matchesTruth("CF", dealSize, "140", "60")).toBe(true);
    expect(matchesTruth("CF", dealSize, "24", "60")).toBe(false);
    expect(matchesTruth("CF", dealSize, "200", "60")).toBe(false);
    expect(matchesTruth("CF", services, "full advisory suite", "Full advisory suite")).toBe(true);
    expect(matchesTruth("CF", services, "Adjacent advisory services", "Full advisory suite")).toBe(
      false,
    );
    expect(matchesTruth("CF", solvent, "true", "true")).toBe(true);
    expect(matchesTruth("CF", solvent, "false", "true")).toBe(false);

    const m = computeMetrics([
      firmEval([
        slot({ kept: [{ provider: "dealdb", value: "140" }], plans: [plan("140")] }),
        slot({ kept: [{ provider: "dealdb", value: "20" }], plans: [plan("20")] }),
      ]),
    ]);
    const dealdb = m.providers.find((p) => p.provider === "dealdb")!;
    expect(dealdb.precision).toBe(0.5);
    expect(dealdb.coverage).toBe(1);
    expect(m.reconciled.precision).toBe(0.5);
    expect(m.reconciled.coverage).toBe(1);
  });

  it("scores a conflict by whether the more trusted position is right", () => {
    const conflict = (lead: string, other: string) =>
      slot({ plans: [plan(lead, "cg"), plan(other, "cg")] });
    const m = computeMetrics([
      firmEval([conflict("60", "10"), conflict("10", "60"), slot({ plans: [plan("60")] })]),
    ]);
    expect(m.reconciled.conflictRate).toBeCloseTo(2 / 3, 4);
    expect(m.reconciled.higherTrustRight).toBe(0.5);
    // Conflicted slots are not settled, so only the third counts toward coverage.
    expect(m.reconciled.coverage).toBeCloseTo(1 / 3, 4);
    expect(m.reconciled.precision).toBe(1);
  });

  it("abstention calibration is 1 when every abstention had no provider value", () => {
    const m = computeMetrics([
      firmEval([slot({ stated: [] }), slot({ stated: [] }), slot({ plans: [plan("60")] })]),
    ]);
    expect(m.abstention.rate).toBeCloseTo(2 / 3, 4);
    expect(m.abstention.calibration).toBe(1);
  });

  it("abstention calibration drops when a provider did state the value", () => {
    const m = computeMetrics([firmEval([slot({ stated: [] }), slot({ stated: ["dealdb"] })])]);
    expect(m.abstention.calibration).toBe(0.5);
  });

  it("tier agreement is the share of firms whose agent tier equals the truth tier", () => {
    const m = computeMetrics([
      firmEval([], { agentTier: "A", truthTier: "A" }),
      firmEval([], { agentTier: "C", truthTier: "B" }),
    ]);
    expect(m.tierAgreement).toBe(0.5);
  });
});
