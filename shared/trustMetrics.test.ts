import { describe, expect, it } from "vitest";
import {
  NULL_OUTCOME_KEY,
  OUTCOME_SLOTS,
  type RatedFinding,
  accuracyTables,
  cellsFromFindings,
  tallyOutcomes,
} from "./trustMetrics.js";

describe("outcome slots", () => {
  it("gives the closed outcome its own slot so a Closed firm is not 'not yet observed'", () => {
    expect(OUTCOME_SLOTS).toContain("closed");
    const t = tallyOutcomes([
      { firmId: "a", lifecycleState: "Closed", outcome: "closed" },
      { firmId: "b", lifecycleState: "Screening", outcome: null },
    ]);
    expect(t.counts.closed).toBe(1);
    expect(t.counts[NULL_OUTCOME_KEY]).toBe(1);
  });
});

const f = (findingId: string, rest: Partial<RatedFinding>): RatedFinding => ({
  findingId,
  ...rest,
});

describe("accuracyTables", () => {
  const findings: RatedFinding[] = [
    f("1", { provider: "dealdb", axis: "deal_size_usd_m", verifiedByHuman: true }),
    f("2", { provider: "dealdb", axis: "dealSizeUsdM", findingStatus: "rejected" }),
    f("3", { provider: "filings", axis: "firm_age", confidenceTier: "abstain" }),
    f("4", { provider: "none", axis: "firm_age", confidenceTier: "abstain" }),
    f("5", { provider: "dealdb+filings", axis: "solvent", findingStatus: "proposed" }),
    f("6", { provider: "analyst", axis: "firm_age", verifiedByHuman: true }),
    f("7", { axis: "firm_age", findingStatus: "proposed" }),
  ];
  const t = accuracyTables(cellsFromFindings(findings));

  it("rates the overall group over every finding", () => {
    expect(t.overall).toMatchObject({ total: 7, decided: 3, agreement: 67, override: 33 });
  });

  it("builds provider rows by label, dropping non-sources and undecided corroboration tags", () => {
    expect(t.byProvider.map((r) => [r.key, r.label, r.r.total])).toEqual([
      ["analyst", "Analyst", 1],
      ["dealdb", "Deal DB", 2],
      ["filings", "Filings", 1],
    ]);
    expect(t.byProvider.find((r) => r.key === "dealdb")!.r.agreement).toBe(50);
  });

  it("folds axis spellings together, drops hard gates and orders by volume", () => {
    expect(t.byAxis.map((r) => [r.key, r.label, r.r.total])).toEqual([
      ["firm_age", "Firm age", 4],
      ["deal_size_usd_m", "Avg deal size", 2],
    ]);
  });

  it("names an axis-less finding's row 'unknown axis'", () => {
    const t2 = accuracyTables(cellsFromFindings([f("1", { provider: "dealdb" })]));
    expect(t2.byAxis).toEqual([
      { key: "__unknown__", label: "unknown axis", r: expect.objectContaining({ total: 1 }) },
    ]);
  });
});
