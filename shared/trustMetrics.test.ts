import { describe, expect, it } from "vitest";
import {
  NULL_OUTCOME_KEY,
  OUTCOME_SLOTS,
  type RatedFinding,
  accuracyTables,
  cellsFromFindings,
  classify,
  rates,
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

  it("builds provider rows by label, dropping pseudo-providers and undecided corroboration tags", () => {
    expect(t.byProvider.map((r) => [r.key, r.label, r.r.total])).toEqual([
      ["dealdb", "Deal DB", 2],
      ["filings", "Filings", 1],
      ["__none__", "No source", 1],
    ]);
    expect(t.byProvider.find((r) => r.key === "dealdb")!.r.agreement).toBe(50);
  });

  it("counts abstentions that no real source produced in their own 'No source' row", () => {
    const t2 = accuracyTables(
      cellsFromFindings([
        f("1", { provider: "agent", confidenceTier: "abstain", findingStatus: "abstained" }),
        f("2", { provider: "none", confidenceTier: "abstain" }),
        f("3", { confidenceTier: "abstain" }),
        f("4", { provider: "analyst", findingStatus: "abstained" }),
        // Not an abstention: an agent or analyst value is not "no source".
        f("5", { provider: "agent", findingStatus: "proposed" }),
        f("6", { provider: "dealdb", verifiedByHuman: true }),
      ]),
    );
    expect(t2.byProvider.map((r) => [r.key, r.label])).toEqual([
      ["dealdb", "Deal DB"],
      ["__none__", "No source"],
    ]);
    const none = t2.byProvider.find((r) => r.key === "__none__")!;
    expect(none.r).toMatchObject({ total: 4, abstention: 100, decided: 0, agreement: null });
    // The pseudo-providers still count in the overall rates.
    expect(t2.overall.total).toBe(6);
  });

  it("omits a provider with no findings, and the 'No source' row when nothing abstained", () => {
    const t2 = accuracyTables([
      { provider: "dealdb", axis: "firm_age", agree: 0, override: 0, abstain: 0, total: 0 },
      { provider: "filings", axis: "firm_age", agree: 1, override: 0, abstain: 0, total: 1 },
    ]);
    expect(t2.byProvider.map((r) => r.key)).toEqual(["filings"]);
    expect(t2.byAxis.map((r) => r.key)).toEqual(["firm_age"]);
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

describe("classify", () => {
  it("counts an analyst-authored verified finding as agree, though verifiedByHuman is unset", () => {
    expect(classify(f("1", { provider: "analyst", findingStatus: "verified" }))).toBe("agree");
    expect(rates([f("1", { provider: "analyst", findingStatus: "verified" })])).toMatchObject({
      decided: 1,
      agreement: 100,
    });
  });

  it("does not credit 'verified' from any other provider, or an analyst abstention", () => {
    expect(classify(f("1", { provider: "dealdb", findingStatus: "verified" }))).toBe("pending");
    expect(classify(f("2", { findingStatus: "verified" }))).toBe("pending");
    expect(
      classify(
        f("3", { provider: "analyst", findingStatus: "verified", confidenceTier: "abstain" }),
      ),
    ).toBe("abstain");
  });

  it("keeps the other classes", () => {
    expect(classify(f("1", { verifiedByHuman: true }))).toBe("agree");
    expect(classify(f("2", { findingStatus: "rejected" }))).toBe("override");
    expect(classify(f("3", { provider: "analyst", findingStatus: "rejected" }))).toBe("override");
    expect(classify(f("4", { findingStatus: "proposed" }))).toBe("pending");
  });
});
