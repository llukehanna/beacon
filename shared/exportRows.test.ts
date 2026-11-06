import { describe, expect, it } from "vitest";
import { CRM_FORMATS } from "./crmFormats.js";
import {
  type FindingLike,
  type FirmLike,
  NO_SOURCE,
  citationsTable,
  exportFileName,
  exportRows,
  neutralise,
  targetsTable,
  toCsv,
} from "./exportRows.js";
import { ENRICH_AXES } from "./vocab.js";

const firm = (over: Partial<FirmLike> = {}): FirmLike => ({
  firmId: "f1",
  firmName: "Harbour Partners",
  firmType: "CF",
  hqCountry: "United Kingdom",
  sector: "Industrials",
  employees: 40,
  ownership: "Partnership",
  coverageModel: "Single-sector focus",
  lifecycleState: "Screening",
  ...over,
});

const finding = (over: Partial<FindingLike> = {}): FindingLike => ({
  findingId: "r1",
  firmId: "f1",
  axis: "services_fit",
  value: "Full advisory suite",
  provider: "filings",
  sourceDocumentId: "filings:f1",
  sourceQuote: "We advise on mergers.",
  extractionModel: "claude-haiku-4-5",
  confidenceTier: "high",
  findingStatus: "proposed",
  retrievedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("exportRows", () => {
  it("handles abstentions and empty lists", () => {
    expect(exportRows([], [])).toEqual({ rows: [], citations: [] });

    const { rows, citations } = exportRows(
      [firm()],
      [
        finding({
          axis: "md_pedigree",
          value: "",
          confidenceTier: "abstain",
          findingStatus: "abstained",
          provider: "none",
          sourceQuote: null,
          extractionModel: null,
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].md_pedigree).toBeNull();
    const cite = citations[0].find((c) => c.axis === "md_pedigree");
    expect(cite).toEqual({ axis: "md_pedigree", provider: null, quote: null, model: null });
    // One citation per axis, so the sheet has a line for every axis a firm could be asked about.
    expect(citations[0]).toHaveLength(ENRICH_AXES.length);
  });

  it("carries a finding's value and where it came from", () => {
    const { rows, citations } = exportRows([firm()], [finding()]);
    expect(rows[0]).toMatchObject({
      firmId: "f1",
      firmName: "Harbour Partners",
      services_fit: "Full advisory suite",
      hqCountry: "United Kingdom",
      stage: "Screening",
    });
    expect(typeof rows[0].score).toBe("number");
    expect(typeof rows[0].tier).toBe("string");
    expect(citations[0].find((c) => c.axis === "services_fit")).toEqual({
      axis: "services_fit",
      provider: "Filings",
      quote: "We advise on mergers.",
      model: "claude-haiku-4-5",
    });
  });

  it("cites no quote for an analyst's entry, whatever note its excerpt holds", () => {
    const { rows, citations } = exportRows(
      [firm()],
      [
        finding({
          provider: "analyst",
          sourceDocumentId: null,
          sourceQuote: null,
          sourceExcerpt: "Analyst entered Full advisory suite, replacing the Filings value.",
          extractionModel: null,
          findingStatus: "verified",
          verifiedByHuman: true,
        }),
      ],
    );
    expect(rows[0].services_fit).toBe("Full advisory suite");
    expect(citations[0].find((c) => c.axis === "services_fit")).toEqual({
      axis: "services_fit",
      provider: "Analyst",
      quote: null,
      model: null,
    });
  });

  it("prefers the human-verified finding, types numbers and gates, and skips superseded ones", () => {
    const { rows } = exportRows(
      [firm()],
      [
        finding({
          findingId: "a",
          axis: "firm_age",
          value: "12",
          retrievedAt: "2026-02-01T00:00:00Z",
        }),
        finding({
          findingId: "b",
          axis: "firm_age",
          value: "30",
          verifiedByHuman: true,
          retrievedAt: "2026-01-01T00:00:00Z",
        }),
        finding({
          findingId: "c",
          axis: "deal_size_usd_m",
          value: "99",
          findingStatus: "superseded",
        }),
        finding({ findingId: "d", axis: "advisory_conflict", value: "no" }),
      ],
    );
    expect(rows[0].firm_age).toBe(30);
    expect(rows[0].deal_size_usd_m).toBeNull();
    expect(rows[0].advisory_conflict).toBe("No");
  });

  it("falls back to the value already on the firm, without a citation", () => {
    const { rows, citations } = exportRows(
      [firm({ servicesFit: "Adjacent advisory services" })],
      [],
    );
    expect(rows[0].services_fit).toBe("Adjacent advisory services");
    expect(citations[0][0].provider).toBeNull();
  });

  it("does not credit a finding that has no value for the firm's own value", () => {
    const { rows, citations } = exportRows(
      [firm({ servicesFit: "Adjacent advisory services" })],
      [finding({ value: "" })],
    );
    expect(rows[0].services_fit).toBe("Adjacent advisory services");
    expect(citations[0].find((c) => c.axis === "services_fit")).toEqual({
      axis: "services_fit",
      provider: null,
      quote: null,
      model: null,
    });
  });

  it("uses the score and tier the page shows when it gives them", () => {
    const { rows } = exportRows([firm({ score: 15, tier: "A" })], []);
    expect(rows[0].score).toBe(15);
    expect(rows[0].tier).toBe("A");
  });
});

describe("neutralises formula-like cells", () => {
  it("prefixes text a spreadsheet would run", () => {
    expect(neutralise("=1+1")).toBe("'=1+1");
    expect(neutralise("+44 20 7946 0000")).toBe("'+44 20 7946 0000");
    expect(neutralise("-cmd")).toBe("'-cmd");
    expect(neutralise("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralise("\tx")).toBe("'\tx");
    expect(neutralise("\rx")).toBe("'\rx");
  });

  it("leaves ordinary text, numbers and empty cells alone", () => {
    expect(neutralise("Harbour = Partners")).toBe("Harbour = Partners");
    expect(neutralise(-5)).toBe(-5);
    expect(neutralise(null)).toBeNull();
  });

  it("applies in the CSV", () => {
    expect(toCsv(["a"], [["=1+1"]])).toBe("a\r\n'=1+1\r\n");
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv(
      ["Name", "Note"],
      [
        ["Smith, Jones", 'said "hi"'],
        ["Line\nbreak", null],
        ["plain", 3],
      ],
    );
    expect(csv).toBe('Name,Note\r\n"Smith, Jones","said ""hi"""\r\n"Line\nbreak",\r\nplain,3\r\n');
  });

  it("never prints undefined", () => {
    const { rows } = exportRows([firm()], []);
    const t = targetsTable(rows);
    expect(toCsv(t.headers, t.rows)).not.toContain("undefined");
  });
});

describe("workbook tables", () => {
  it("reads an empty axis or citation as no source", () => {
    const { rows, citations } = exportRows([firm()], [finding()]);
    const t = targetsTable(rows);
    expect(t.headers.slice(0, 3)).toEqual(["Firm", "Tier", "Score"]);
    expect(t.headers[t.headers.length - 1]).toBe("Firm ID");
    expect(t.rows[0]).toHaveLength(t.headers.length);
    expect(t.rows[0]).toContain(NO_SOURCE);
    const c = citationsTable(rows, citations);
    expect(c.headers).toEqual(["Firm", "Axis", "Provider", "Quote", "Model"]);
    expect(c.rows).toHaveLength(ENRICH_AXES.length);
    expect(c.rows.every((r) => r.length === 5 && r.every((x) => x !== null))).toBe(true);
    expect(c.rows[0]).toEqual([
      "Harbour Partners",
      "Services fit",
      "Filings",
      "We advise on mergers.",
      "claude-haiku-4-5",
    ]);
  });
});

describe("exportFileName", () => {
  it("is beacon-<name>-<date> with a safe slug", () => {
    const now = new Date(2026, 10, 6, 9, 30);
    expect(exportFileName("Working set", "xlsx", now)).toBe("beacon-working-set-2026-11-06.xlsx");
    expect(exportFileName("EU mid-market / Q4 ?", "csv", now)).toBe(
      "beacon-eu-mid-market-q4-2026-11-06.csv",
    );
    expect(exportFileName("???", "csv", now)).toBe("beacon-targets-2026-11-06.csv");
  });

  it("keeps the CRM name when the base name is long", () => {
    const now = new Date(2026, 10, 6);
    const long =
      "Find owner-managed advisory boutiques in the Nordics with a succession gap".repeat(2);
    const names = ["Salesforce", "DealCloud", "Affinity"].map((crm) =>
      exportFileName(long, "csv", now, crm),
    );
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toMatch(/-salesforce-2026-11-06\.csv$/);
  });
});

describe("CRM formats", () => {
  const { rows } = exportRows(
    [firm(), firm({ firmId: "f2", firmName: "=Evil Corp", employees: null, hqCountry: null })],
    [],
  );

  it("pins each header list", () => {
    expect(CRM_FORMATS.salesforce.headers).toEqual([
      "Account Name",
      "Billing Country",
      "Industry",
      "Employees",
      "Ownership",
      "Rating",
      "Account Source",
      "Description",
      "Beacon Firm ID",
    ]);
    expect(CRM_FORMATS.dealcloud.headers).toEqual([
      "Company Name",
      "Company Type",
      "HQ Country",
      "Industry",
      "Employee Count",
      "Revenue Band",
      "Ownership Type",
      "Pipeline Stage",
      "Beacon Tier",
      "Beacon Score",
      "Beacon Firm ID",
    ]);
    expect(CRM_FORMATS.affinity.headers).toEqual([
      "Organization Name",
      "Location",
      "Industry",
      "Employees",
      "Status",
      "Tier",
      "Score",
      "Succession Risk",
      "Source",
      "Beacon Firm ID",
    ]);
  });

  it.each(["salesforce", "dealcloud", "affinity"] as const)(
    "%s rows match the header width",
    (name) => {
      const fmt = CRM_FORMATS[name];
      for (const r of rows) {
        expect(fmt.map(r)).toHaveLength(fmt.headers.length);
      }
      const csv = toCsv(fmt.headers, rows.map(fmt.map));
      expect(csv).not.toContain("undefined");
      expect(csv).toContain("'=Evil Corp");
    },
  );

  it("rates the tier the way Salesforce does", () => {
    const [a, b, c, out] = ["A", "B", "C", "Rejected"].map(
      (tier) => CRM_FORMATS.salesforce.map({ ...rows[0], tier })[5],
    );
    expect([a, b, c, out]).toEqual(["Hot", "Warm", "Cold", null]);
  });
});
