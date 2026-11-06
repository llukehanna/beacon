import { describe, expect, it } from "vitest";
import { type FindingLike } from "../desk/axisState";
import { type FirmView } from "../desk/firmDesk/deskModel";
import { type DecisionInput, buildTearSheet, localDay } from "./tearSheetModel";

const firm: FirmView = {
  firmId: "acme_us",
  firmName: "Acme Advisors",
  firmType: "CF",
  sector: "Industrials",
  hqCountry: "United States",
  coverageModel: "Single-sector",
  servicesFit: "Full advisory suite",
  mdPedigree: "Mixed: industry or boutique banking",
  geoScore: 2,
  dealSizeMUsd: 80,
  dealsPerMdL3y: 2,
  firmAge: 9,
  employees: 20,
  feeGeneratingCount: 3,
  lifecycleState: "Screening",
  revenueBand: "$10-25m",
};

const finding = (over: Partial<FindingLike> & { findingId: string }): FindingLike => ({
  provider: "dealdb",
  findingStatus: "proposed",
  retrievedAt: "2026-05-01T00:00:00Z",
  ...over,
});

describe("buildTearSheet", () => {
  it("reads the live score, tier and per-axis breakdown from the rubric", () => {
    const sheet = buildTearSheet({ firm, findings: [], decisions: [], rules: [] });
    expect(sheet.name).toBe("Acme Advisors");
    expect(sheet.stage).toBe("Screening");
    expect(sheet.score.max).toBe(18);
    expect(sheet.score.total).toBe(sheet.axes.reduce((n, a) => n + (a.points ?? 0), 0));
    expect(sheet.score.tierText).toMatch(/^Tier [ABC]$/);
    expect(sheet.axes.map((a) => a.axis)).toContain("Deal Size");
    expect(sheet.axes.find((a) => a.axis === "Deal Size")).toEqual({
      axis: "Deal Size",
      value: "$80m",
      points: 1,
    });
    expect(sheet.facts).toEqual(
      expect.arrayContaining([
        { label: "Sector", value: "Industrials" },
        { label: "HQ", value: "United States" },
        { label: "Revenue", value: "$10-25m" },
      ]),
    );
  });

  it("cites the quote, provider and model behind each value", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [
        finding({
          findingId: "f1",
          axis: "firm_age",
          value: "9",
          sourceQuote: "The firm has been operating for 9 years.",
          extractionModel: "claude-haiku-4-5",
          sourceDocumentId: "dealdb:acme_us",
        }),
        finding({
          findingId: "f2",
          axis: "fee_generating_count",
          value: "3",
          provider: "analyst",
          findingStatus: "verified",
          verifiedByHuman: true,
        }),
      ],
      decisions: [],
      rules: [],
    });
    const age = sheet.evidence.find((e) => e.axis === "Firm age");
    expect(age).toEqual({
      axis: "Firm age",
      value: "9",
      status: "proposed",
      provider: "Deal DB",
      quote: "The firm has been operating for 9 years.",
      model: "claude-haiku-4-5",
    });
    const analyst = sheet.evidence.find((e) => e.axis === "Fee-earning heads");
    expect(analyst).toMatchObject({
      status: "verified",
      provider: "Analyst",
      quote: null,
      model: null,
    });
  });

  it("states open conflicts with both sides and abstentions on their own", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [
        finding({
          findingId: "c1",
          axis: "deals_per_md_l3y",
          value: "2",
          conflictGroupId: "g1",
          provider: "dealdb",
          sourceDocumentId: "dealdb:acme_us",
          extractionModel: "claude-haiku-4-5",
          sourceQuote: "The firm averaged 2 closed deals per managing director.",
        }),
        finding({
          findingId: "c2",
          axis: "deals_per_md_l3y",
          value: "4",
          conflictGroupId: "g1",
          provider: "websearch",
          sourceDocumentId: "websearch:acme_us",
          extractionModel: "claude-haiku-4-5",
          sourceQuote: "The firm averaged 4 closed deals per managing director.",
        }),
        finding({
          findingId: "a1",
          axis: "md_pedigree",
          findingStatus: "abstained",
          confidenceTier: "abstain",
        }),
      ],
      decisions: [],
      rules: [],
    });
    expect(sheet.conflicts).toHaveLength(1);
    expect(sheet.conflicts[0].axis).toBe("Deals / MD (L3Y)");
    expect(sheet.conflicts[0].sides.map((s) => [s.provider, s.value])).toEqual([
      ["Deal DB", "2"],
      ["Web search", "4"],
    ]);
    expect(sheet.abstentions).toEqual([
      { axis: "MD pedigree", onFile: "Mixed: industry or boutique banking" },
    ]);
    // A conflict or an abstention is not evidence for a value.
    expect(sheet.evidence).toEqual([]);
  });

  it("lists decisions newest first, and shows the at-decision score for a passed firm only", () => {
    const decisions: DecisionInput[] = [
      {
        decisionId: "d1",
        firmId: "acme_us",
        decisionType: "advance",
        decidedAt: "2026-03-01T10:00:00Z",
        scoreAtDecision: 12,
        tierAtDecision: "B",
      },
      {
        decisionId: "d2",
        firmId: "acme_us",
        decisionType: "reject",
        rejectionRationale: "Too small for the mandate",
        decidedAt: "2026-04-01T10:00:00Z",
        scoreAtDecision: 7,
        tierAtDecision: "C",
      },
    ];
    const open = buildTearSheet({ firm, findings: [], decisions, rules: [] });
    expect(open.decisions.map((d) => d.label)).toEqual(["Passed", "Advanced"]);
    expect(open.atDecision).toBeNull();

    const passed = buildTearSheet({
      firm: { ...firm, lifecycleState: "Passed" },
      findings: [],
      decisions,
      rules: [],
    });
    expect(passed.stage).toBe("Passed");
    expect(passed.atDecision).toEqual({ total: 7, tier: "C" });
    // The live score is still the live one.
    expect(passed.score.total).toBe(open.score.total);
    expect(passed.decisions[0]).toMatchObject({ rationale: "Too small for the mandate", score: 7 });
  });

  it("says a hard-screened firm is rejected, with the reason", () => {
    const sheet = buildTearSheet({
      firm: { ...firm, coverageModel: "Generalist" },
      findings: [],
      decisions: [],
      rules: [],
    });
    expect(sheet.score.total).toBe(0);
    expect(sheet.score.tierText).toBe("Rejected");
    expect(sheet.score.screenedBecause).toMatch(/Generalist/);
    // The screen is shown beside the stage; nobody passed this firm, so it is not "Passed".
    expect(sheet.stage).toBe("Screening");
    expect(sheet.atDecision).toBeNull();
  });

  it("never cites an analyst's note as a source sentence", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [
        finding({
          findingId: "n1",
          axis: "firm_age",
          value: "9",
          provider: "analyst",
          findingStatus: "verified",
          verifiedByHuman: true,
          sourceDocumentId: null,
          sourceQuote: null,
          sourceExcerpt: "Analyst entered 9, replacing the Deal DB value 12.",
          extractionModel: null,
        }),
        // A finding with a quote but no document is not sourced either.
        finding({
          findingId: "n2",
          axis: "fee_generating_count",
          value: "3",
          provider: "dealdb",
          sourceDocumentId: null,
          sourceQuote: "A sentence with no document behind it.",
          sourceExcerpt: "A synthetic excerpt.",
        }),
      ],
      decisions: [],
      rules: [],
    });
    expect(sheet.evidence.map((e) => [e.axis, e.provider, e.quote, e.model])).toEqual([
      ["Firm age", "Analyst", null, null],
      ["Fee-earning heads", "Analyst", null, null],
    ]);
    expect(sheet.hasQuotes).toBe(false);
  });

  it("credits a corroborated finding's quote to the provider whose document holds it", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [
        finding({
          findingId: "k1",
          axis: "firm_age",
          value: "9",
          provider: "dealdb+filings",
          sourceDocumentId: "dealdb:acme_us",
          sourceQuote: "The firm has been operating for 9 years.",
          extractionModel: "claude-haiku-4-5",
        }),
      ],
      decisions: [],
      rules: [],
    });
    expect(sheet.evidence[0]).toMatchObject({ provider: "Deal DB", model: "claude-haiku-4-5" });
    expect(sheet.hasQuotes).toBe(true);
  });

  it("lists at most two sides of a conflict, most trusted source first", () => {
    const side = (id: string, provider: string, value: string) =>
      finding({
        findingId: id,
        axis: "deals_per_md_l3y",
        value,
        provider,
        conflictGroupId: "g1",
        sourceDocumentId: `${provider}:acme_us`,
        sourceQuote: `Quote from ${provider}.`,
      });
    const sheet = buildTearSheet({
      firm,
      findings: [
        side("s1", "websearch", "4"),
        side("s2", "filings", "3"),
        side("s3", "beacondb", "1"),
      ],
      decisions: [],
      rules: [],
    });
    expect(sheet.conflicts[0].sides.map((s) => s.provider)).toEqual(["BeaconDB", "Filings"]);
  });

  it("says whether the agent has run, and not before", () => {
    const none = buildTearSheet({ firm, findings: [], decisions: [], rules: [] });
    expect(none.researched).toBe(false);
    const analystOnly = buildTearSheet({
      firm,
      findings: [finding({ findingId: "x", provider: "analyst", axis: "firm_age", value: "9" })],
      decisions: [],
      rules: [],
    });
    expect(analystOnly.researched).toBe(false);
    const ran = buildTearSheet({
      firm,
      findings: [finding({ findingId: "y", axis: "firm_age", value: "9" })],
      decisions: [],
      rules: [],
    });
    expect(ran.researched).toBe(true);
  });
});

describe("localDay", () => {
  it("uses the reader's calendar day, not the UTC one", () => {
    const evening = new Date(2026, 10, 6, 23, 30).getTime();
    expect(localDay(evening)).toBe("2026-11-06");
    expect(localDay(new Date(2026, 0, 2, 0, 5).getTime())).toBe("2026-01-02");
  });
});
