import { describe, expect, it } from "vitest";
import { axisByName } from "../../shared/vocab.js";
import type { FindingPlan } from "../enrichment/reconcile.js";
import { classifySlot, failureTaxonomy } from "./failures.js";
import type { FirmEvaluation, SlotResult } from "./pipeline.js";

const dealSize = axisByName("deal_size_usd_m")!;
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
  firmId: "f1",
  model: "CF",
  axis: dealSize,
  truth: "60",
  stated: [],
  kept: [],
  plans: [plan("60")],
  ...over,
});

const firmEval = (firmId: string, slots: SlotResult[]): FirmEvaluation => ({
  firmId,
  model: "CF",
  extractionModel: "rule-based",
  slots: slots.map((s) => ({ ...s, firmId })),
  truthTier: "B",
  agentTier: "B",
});

describe("classifySlot", () => {
  it("is null when the agent settled on the true value (a numeric value in the true band counts)", () => {
    expect(classifySlot(slot({ plans: [plan("60")] }))).toBeNull();
    expect(classifySlot(slot({ plans: [plan("140")] }))).toBeNull();
  });

  it("wrong-source-wins: a wrong value was settled because no other source disagreed", () => {
    expect(classifySlot(slot({ plans: [plan("20")] }))).toBe("wrong-source-wins");
    expect(classifySlot(slot({ axis: solvent, truth: "true", plans: [plan("false")] }))).toBe(
      "wrong-source-wins",
    );
  });

  it("conflict-surfaced: two positions went to the analyst, whichever was right", () => {
    expect(classifySlot(slot({ plans: [plan("60", "cg"), plan("20", "cg")] }))).toBe(
      "conflict-surfaced",
    );
    expect(classifySlot(slot({ plans: [plan("20", "cg"), plan("60", "cg")] }))).toBe(
      "conflict-surfaced",
    );
  });

  it("abstained-correctly: no source's record stated the axis", () => {
    expect(classifySlot(slot({ plans: [plan(null)], stated: [] }))).toBe("abstained-correctly");
  });

  it("abstained-wrongly: a record stated the axis but the value did not survive", () => {
    expect(classifySlot(slot({ plans: [plan(null)], stated: ["dealdb"] }))).toBe(
      "abstained-wrongly",
    );
  });
});

describe("failureTaxonomy", () => {
  const evals = [
    firmEval("a", [slot({}), slot({ plans: [plan("20")] }), slot({ plans: [plan(null)] })]),
    firmEval("b", [
      slot({ plans: [plan("20")] }),
      slot({ axis: solvent, truth: "true", plans: [plan("false")] }),
      slot({ plans: [plan("20")] }),
      slot({ plans: [plan("60", "cg"), plan("20", "cg")] }),
      slot({ plans: [plan(null)], stated: ["filings"] }),
    ]),
  ];

  it("always lists every kind, in a fixed order", () => {
    const t = failureTaxonomy([]);
    expect(t.slots).toEqual({ total: 0, correct: 0 });
    expect(t.failures.map((f) => f.kind)).toEqual([
      "wrong-source-wins",
      "conflict-surfaced",
      "abstained-correctly",
      "abstained-wrongly",
    ]);
    expect(t.failures.every((f) => f.count === 0 && f.examples.length === 0)).toBe(true);
  });

  it("counts every slot that is not correct exactly once", () => {
    const t = failureTaxonomy(evals);
    expect(t.slots).toEqual({ total: 8, correct: 1 });
    const counts = Object.fromEntries(t.failures.map((f) => [f.kind, f.count]));
    expect(counts).toEqual({
      "wrong-source-wins": 4,
      "conflict-surfaced": 1,
      "abstained-correctly": 1,
      "abstained-wrongly": 1,
    });
    const sum = t.failures.reduce((n, f) => n + f.count, 0);
    expect(sum).toBe(t.slots.total - t.slots.correct);
  });

  it("keeps at most three examples per kind, from different firms, the first in firm order", () => {
    const more = [
      ...evals,
      firmEval("c", [slot({ plans: [plan("20")] })]),
      firmEval("d", [slot({ plans: [plan("20")] })]),
    ];
    const wrong = failureTaxonomy(more).failures.find((f) => f.kind === "wrong-source-wins")!;
    expect(wrong.count).toBe(6);
    expect(wrong.examples).toEqual([
      { firmId: "a", axis: "deal_size_usd_m" },
      { firmId: "b", axis: "deal_size_usd_m" },
      { firmId: "c", axis: "deal_size_usd_m" },
    ]);
    // Two firms only: two examples, not three from the same firm.
    expect(failureTaxonomy(evals).failures[0].examples).toHaveLength(2);
  });
});
