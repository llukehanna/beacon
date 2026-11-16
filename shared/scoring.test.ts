import { describe, expect, it } from "vitest";
import { parseTraitValue } from "./rubric/traitValue.js";
import { legacyTraits } from "./rubric/workspace.js";
import { scoreFirm } from "./scoring.js";
import { ADVISORY_ACQUISITIONS as WS } from "./workspaces/advisoryAcquisitions.js";

/** Score a firm written with column names, the way the server sees it. */
const score = (f: Record<string, unknown>) =>
  scoreFirm(WS.rubric, { ...f, traits: legacyTraits(WS, f) });

const STRONG_CF = {
  firmType: "CF",
  coverageModel: "Single-sector focus",
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  geoScore: 2,
  dealSizeMUsd: 200,
  dealsPerMdL3y: 5,
  firmAge: 15,
  employees: 20,
  feeGeneratingCount: 4,
};

describe("scoreFirm (rubric v2 eval suite)", () => {
  it("CF fully enriched → A, 18", () => {
    const r = score(STRONG_CF);
    expect([r.tier, r.weightedTotal, r.maxPossible, r.hardRejected]).toEqual(["A", 18, 18, false]);
  });

  it("CS fully enriched → A, 18", () => {
    const r = score({
      ...STRONG_CF,
      firmType: "CS",
      balanceSheetPrincipal: "Advisory only",
      servicesFit: "Full private-capital suite",
      mdPedigree: "Senior credit / capital-markets pedigree",
    });
    expect([r.tier, r.weightedTotal]).toEqual(["A", 18]);
  });

  it("CS principal investor → hard reject", () => {
    expect(
      score({
        ...STRONG_CF,
        firmType: "CS",
        balanceSheetPrincipal: "Invests its own balance sheet",
      }).hardRejected,
    ).toBe(true);
  });

  it("headcount has a sweet spot: 8–40 beats both smaller and larger", () => {
    const points = (employees: number) => score({ ...STRONG_CF, employees }).weightedTotal;
    expect([points(5), points(20), points(300)]).toEqual([16, 18, 17]);
  });

  it("CF generalist → hard reject, 0", () => {
    const r = score({ ...STRONG_CF, coverageModel: "Generalist" });
    expect([r.hardRejected, r.weightedTotal, r.tier]).toEqual([true, 0, "Rejected"]);
  });

  it("CF conflicted services → hard reject", () => {
    expect(
      score({ ...STRONG_CF, servicesFit: "Conflicted: trading, lending or research" }).hardRejected,
    ).toBe(true);
  });

  it("CS advisory conflict → hard reject", () => {
    expect(score({ ...STRONG_CF, firmType: "CS", advisoryConflict: true }).hardRejected).toBe(true);
  });

  it("CF B tier at the outreach floor → B, 12, Outreach; one point lower → Follow", () => {
    const b = {
      ...STRONG_CF,
      servicesFit: "Adjacent advisory services",
      mdPedigree: "Mixed: industry or boutique banking",
      dealSizeMUsd: 50,
      dealsPerMdL3y: 3,
      firmAge: 8,
      feeGeneratingCount: 3,
    };
    const r = score(b);
    expect([r.tier, r.weightedTotal, r.action]).toEqual(["B", 12, "Outreach"]);
    expect(score({ ...b, feeGeneratingCount: 1 }).action).toBe("Follow");
  });

  it("unknown values score 0", () => {
    const r = score({ firmType: "CS" });
    expect([r.weightedTotal, r.tier, r.confidence]).toEqual([0, "Rejected", 0]);
  });
});

describe("trait values", () => {
  const trait = (traitKey: string) => WS.traits.find((t) => t.traitKey === traitKey)!;

  it("parses a finding's value by the trait's kind", () => {
    expect(parseTraitValue(trait("deal_size_usd_m"), "42.5")).toBe(42.5);
    expect(parseTraitValue(trait("deal_size_usd_m"), "n/a")).toBeNull();
    expect(parseTraitValue(trait("solvent"), "Yes")).toBe(true);
    expect(parseTraitValue(trait("solvent"), "0")).toBe(false);
    expect(parseTraitValue(trait("services_fit"), "  Full advisory suite ")).toBe(
      "Full advisory suite",
    );
  });
});
