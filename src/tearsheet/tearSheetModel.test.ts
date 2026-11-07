import { describe, expect, it } from "vitest";
import { firmEvidence } from "../../server/mcp/evidence";
import type { ObjectOf } from "../../shared/schema";
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
    expect(sheet.axes.map((a) => a.axis)).toContain("Avg deal size");
    expect(sheet.axes.find((a) => a.axis === "Avg deal size")).toEqual({
      axis: "Avg deal size",
      value: "$80m",
      points: 1,
      status: "on_file",
    });
    expect(sheet.facts).toEqual(
      expect.arrayContaining([
        { label: "Sector", value: "Industrials" },
        { label: "HQ", value: "United States" },
        { label: "Revenue", value: "$10-25m" },
      ]),
    );
  });

  it("shows an open proposal where nothing is on file, marked unverified and not scored", () => {
    const bare: FirmView = {
      ...firm,
      dealSizeMUsd: undefined,
      firmAge: undefined,
      mdPedigree: undefined,
      feeGeneratingCount: undefined,
    };
    const findings = [
      finding({ findingId: "p", axis: "deal_size_usd_m", value: "46" }),
      finding({ findingId: "c1", axis: "firm_age", value: "24", conflictGroupId: "g" }),
      finding({
        findingId: "c2",
        axis: "firm_age",
        value: "33",
        provider: "filings",
        conflictGroupId: "g",
      }),
      finding({
        findingId: "a",
        axis: "md_pedigree",
        value: "",
        provider: "none",
        findingStatus: "abstained",
      }),
    ];
    const sheet = buildTearSheet({ firm: bare, findings, decisions: [], rules: [] });
    const line = (axis: string) => sheet.axes.find((a) => a.axis === axis);
    expect(line("Avg deal size")).toEqual({
      axis: "Avg deal size",
      value: "$46m",
      points: null,
      status: "proposed",
    });
    expect(line("Firm age")).toEqual({
      axis: "Firm age",
      value: "Sources disagree",
      points: null,
      status: "conflict",
    });
    // Abstained, and nothing else known: still unknown.
    expect(line("MD pedigree")).toMatchObject({ value: "—", points: null, status: "unknown" });
    expect(line("Fee-earning heads")).toMatchObject({ points: null, status: "unknown" });
    // A proposal earns nothing until it is verified: the live score is the record's.
    expect(sheet.score.total).toBe(sheet.axes.reduce((n, a) => n + (a.points ?? 0), 0));

    // The MCP's evidence calls the same axes proposed and in conflict.
    const evidence = firmEvidence(
      asRow<"Firm">({ ...bare, $apiName: "Firm", $primaryKey: "acme_us" }),
      findings.map((f) => asRow<"ResearchFinding">({ ...f, $primaryKey: f.findingId })),
    );
    const status = (axis: string) => evidence.axes.find((a) => a.axis === axis);
    expect(status("deal_size_usd_m")).toMatchObject({ status: "proposed", value: "$46m" });
    expect(status("firm_age")?.status).toBe("conflict");
    expect(status("md_pedigree")?.status).toBe("abstained");
  });

  it("keeps a value on file over an open proposal for the same axis", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [finding({ findingId: "p", axis: "deal_size_usd_m", value: "46" })],
      decisions: [],
      rules: [],
    });
    expect(sheet.axes.find((a) => a.axis === "Avg deal size")).toMatchObject({
      value: "$80m",
      points: 1,
      status: "on_file",
    });
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
      synthetic: false,
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
    expect(sheet.conflicts[0].axis).toBe("Deals per MD (last 3 years)");
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
    expect(sheet.conflicts[0].sides.map((s) => s.provider)).toEqual([
      "Internal CRM (mock)",
      "Filings",
    ]);
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

/**
 * A fixture as the database row the tool reads. The fixtures here are partial (every column the
 * tool reads is optional), which the row type cannot say, so the one cast is made here.
 */
const asRow = <N extends "Firm" | "ResearchFinding">(fixture: object): ObjectOf<N> =>
  fixture as ObjectOf<N>;

describe("the tear sheet and the MCP's firm evidence", () => {
  it("say the same thing about the same findings", () => {
    const findings = [
      finding({
        findingId: "v",
        axis: "firm_age",
        value: "9",
        findingStatus: "verified",
        verifiedByHuman: true,
        sourceQuote: "The firm has been operating for 9 years.",
        extractionModel: "claude-haiku-4-5",
        sourceDocumentId: "dealdb:acme_us",
      }),
      finding({ findingId: "p", axis: "fee_generating_count", value: "3", provider: "analyst" }),
      finding({
        findingId: "c1",
        axis: "deal_size_usd_m",
        value: "80",
        provider: "dealdb",
        sourceDocumentId: "dealdb:acme_us",
        sourceQuote: "Average deal size is $80m across the period.",
        conflictGroupId: "g1",
      }),
      finding({
        findingId: "c2",
        axis: "deal_size_usd_m",
        value: "120",
        provider: "filings",
        sourceDocumentId: "filings:acme_us",
        sourceQuote: "Deals average $120m in the latest filing.",
        extractionModel: "claude-haiku-4-5",
        conflictGroupId: "g1",
      }),
      finding({
        findingId: "a",
        axis: "md_pedigree",
        value: "",
        provider: "none",
        findingStatus: "abstained",
        confidenceTier: "abstain",
      }),
    ];
    const sheet = buildTearSheet({ firm, findings, decisions: [], rules: [] });
    const evidence = firmEvidence(
      asRow<"Firm">({ ...firm, $apiName: "Firm", $primaryKey: "acme_us" }),
      findings.map((f) => asRow<"ResearchFinding">({ ...f, $primaryKey: f.findingId })),
    );
    const cite = (c: {
      value?: unknown;
      provider?: unknown;
      quote?: unknown;
      model?: unknown;
    }) => ({
      value: c.value,
      provider: c.provider,
      quote: c.quote,
      model: c.model,
    });
    expect(
      evidence.axes
        .filter((a) => ["verified", "proposed", "signal"].includes(a.status))
        .map((a) => ({ axis: a.label, status: a.status, ...cite(a) })),
    ).toEqual(sheet.evidence.map((e) => ({ axis: e.axis, status: e.status, ...cite(e) })));
    expect(
      evidence.axes
        .filter((a) => a.status === "conflict")
        .map((a) => ({ axis: a.label, sides: a.sides.map(cite) })),
    ).toEqual(sheet.conflicts.map((c) => ({ axis: c.axis, sides: c.sides.map(cite) })));
    expect(evidence.axes.filter((a) => a.status === "abstained").map((a) => a.label)).toEqual(
      sheet.abstentions.map((a) => a.axis),
    );
    // Not vacuous: each kind is present, and a conflict lists both sides.
    expect(sheet.evidence.length).toBeGreaterThan(1);
    expect(sheet.conflicts).toHaveLength(1);
    expect(sheet.conflicts[0].sides).toHaveLength(2);
    expect(sheet.abstentions).toHaveLength(1);
    expect(evidence.score.total).toBe(sheet.score.total);
  });
});

describe("market signals on the sheet", () => {
  const signal = (id: string, over: Record<string, unknown> = {}) => ({
    signalId: id,
    firmId: "acme_us",
    kind: "departure",
    effectiveDate: "2026-05-02T00:00:00.000Z",
    appliedAt: "2026-05-02T00:00:00.000Z",
    headline: "Acme loses a partner",
    axis: "fee_generating_count",
    newValue: "2",
    ...over,
  });

  it("lists the applied signals newest first, each labelled synthetic, and none that is still to come", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [],
      decisions: [],
      rules: [],
      signals: [
        signal("older", { effectiveDate: "2026-04-20T00:00:00.000Z", kind: "senior_hire" }),
        signal("newer"),
        signal("later", { effectiveDate: "2099-01-01T00:00:00.000Z", appliedAt: undefined }),
      ],
    });
    expect(sheet.signals.map((s) => s.id)).toEqual(["newer", "older"]);
    expect(sheet.signals[0]).toMatchObject({
      headline: "Acme loses a partner",
      kind: "Departure",
      moved: "Fee-earning heads → 2",
      label: "Synthetic market signal",
    });
    expect(sheet.signals[1].kind).toBe("Senior hire");
  });

  it("has no signals when none is given", () => {
    expect(buildTearSheet({ firm, findings: [], decisions: [], rules: [] }).signals).toEqual([]);
  });

  it("credits a signal's finding to the synthetic signal, never to an analyst, and never quotes it", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [
        finding({
          findingId: "ms1",
          axis: "fee_generating_count",
          value: "2",
          provider: "market_signal",
          findingStatus: "signal",
          sourceExcerpt: "Acme loses a partner",
        }),
      ],
      decisions: [],
      rules: [],
    });
    const item = sheet.evidence.find((e) => e.axis === "Fee-earning heads");
    expect(item).toMatchObject({
      status: "signal",
      provider: "Synthetic market signal",
      quote: null,
      model: null,
      synthetic: true,
    });
    expect(sheet.hasQuotes).toBe(false);
  });

  it("shows the newer of a signal and an analyst's check as the value on the sheet", () => {
    const analyst = (at: string) =>
      finding({
        findingId: "mine",
        axis: "fee_generating_count",
        value: "5",
        provider: "analyst",
        findingStatus: "verified",
        verifiedByHuman: true,
        verifiedAt: at,
        retrievedAt: at,
      });
    const signal = finding({
      findingId: "sig",
      axis: "fee_generating_count",
      value: "2",
      provider: "market_signal",
      findingStatus: "signal",
      retrievedAt: "2026-05-02T00:00:00Z",
    });
    const heads = (findings: FindingLike[]) =>
      buildTearSheet({ firm, findings, decisions: [], rules: [] }).evidence.find(
        (e) => e.axis === "Fee-earning heads",
      );
    expect(heads([analyst("2026-05-01T00:00:00Z"), signal])).toMatchObject({
      value: "2",
      status: "signal",
      synthetic: true,
    });
    expect(heads([analyst("2026-05-03T00:00:00Z"), signal])).toMatchObject({
      status: "verified",
      synthetic: false,
    });
  });

  it("does not call a signal's finding research", () => {
    const sheet = buildTearSheet({
      firm,
      findings: [
        finding({ findingId: "ms1", axis: "firm_age", value: "9", provider: "market_signal" }),
      ],
      decisions: [],
      rules: [],
    });
    expect(sheet.researched).toBe(false);
  });
});

describe("localDay", () => {
  it("uses the reader's calendar day, not the UTC one", () => {
    const evening = new Date(2026, 10, 6, 23, 30).getTime();
    expect(localDay(evening)).toBe("2026-11-06");
    expect(localDay(new Date(2026, 0, 2, 0, 5).getTime())).toBe("2026-01-02");
  });
});
