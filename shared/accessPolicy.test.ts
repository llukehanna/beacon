import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_ONLY_TYPES,
  DEFAULT_PERSONA,
  type MandateGrant,
  PERSONAS,
  type Persona,
  type PolicyObject,
  canSee,
  codenameFor,
  firmColumnOf,
  hasNeedToKnow,
  hiddenFirmsFor,
  parsePersona,
  redactDerivedName,
  redactMandate,
  redactObject,
  uniqueCodename,
  visibilityOf,
  walledMandateIds,
} from "./accessPolicy.js";

const RESTRICTED = new Set(["firm-r"]);
const GRANTS: MandateGrant[] = [
  // m-open: everyone. m-walled: deal lead and compliance, not the analyst.
  { mandateId: "m-open", persona: "analyst" },
  { mandateId: "m-open", persona: "deal_lead" },
  { mandateId: "m-open", persona: "compliance" },
  { mandateId: "m-walled", persona: "deal_lead" },
  { mandateId: "m-walled", persona: "compliance" },
];

const obj = (type: string, id: string, firmId?: string): PolicyObject => ({
  $apiName: type,
  $primaryKey: id,
  firmId,
});

describe("parsePersona", () => {
  it("takes the three personas, in any case, and falls back to the analyst", () => {
    expect(parsePersona("deal_lead")).toBe("deal_lead");
    expect(parsePersona("Compliance")).toBe("compliance");
    expect(parsePersona(" analyst ")).toBe("analyst");
    for (const bad of [null, undefined, "", "admin", "root", "deal-lead"]) {
      expect(parsePersona(bad)).toBe(DEFAULT_PERSONA);
    }
  });
});

describe("visibilityOf: who sees what", () => {
  // [description, object, analyst, deal lead, compliance]
  const TABLE: [string, PolicyObject, string, string, string][] = [
    ["an ordinary firm", obj("Firm", "firm-a"), "full", "full", "full"],
    ["a restricted firm", obj("Firm", "firm-r"), "hidden", "hidden", "full"],
    [
      "a finding of an ordinary firm",
      obj("ResearchFinding", "f1", "firm-a"),
      "full",
      "full",
      "full",
    ],
    [
      "a finding of a restricted firm",
      obj("ResearchFinding", "f2", "firm-r"),
      "hidden",
      "hidden",
      "full",
    ],
    [
      "a score of a restricted firm",
      obj("QualificationScore", "s", "firm-r"),
      "hidden",
      "hidden",
      "full",
    ],
    [
      "a decision of a restricted firm",
      obj("ReviewDecision", "d", "firm-r"),
      "hidden",
      "hidden",
      "full",
    ],
    [
      "a drift event of a restricted firm",
      obj("DriftEvent", "e", "firm-r"),
      "hidden",
      "hidden",
      "full",
    ],
    [
      "a market signal of a restricted firm",
      obj("MarketSignal", "g", "firm-r"),
      "hidden",
      "hidden",
      "full",
    ],
    [
      "a search membership of a restricted firm",
      obj("SearchMembership", "sm", "firm-r"),
      "hidden",
      "hidden",
      "full",
    ],
    [
      "a search membership of an ordinary firm",
      obj("SearchMembership", "sm2", "firm-a"),
      "full",
      "full",
      "full",
    ],
    ["a mandate everyone holds", obj("Mandate", "m-open"), "full", "full", "full"],
    [
      "a mandate the analyst holds no grant on",
      obj("Mandate", "m-walled"),
      "codename",
      "full",
      "full",
    ],
    ["a mandate nobody has been granted", obj("Mandate", "m-new"), "full", "full", "full"],
    ["a search", obj("Search", "s1"), "full", "full", "full"],
    ["the restricted list", obj("RestrictedFirm", "firm-r"), "hidden", "hidden", "full"],
    ["the access log", obj("AccessLogEntry", "e1"), "hidden", "hidden", "full"],
    ["the grants", obj("MandateAccess", "a1"), "hidden", "hidden", "full"],
  ];

  it.each(TABLE)("%s", (_what, object, analyst, dealLead, compliance) => {
    const expected: Record<Persona, string> = {
      analyst,
      deal_lead: dealLead,
      compliance,
    };
    for (const persona of PERSONAS) {
      expect(visibilityOf(persona, object, GRANTS, RESTRICTED), persona).toBe(expected[persona]);
    }
  });

  it("canSee is true for everything but hidden, and accepts a list of restricted ids", () => {
    expect(canSee("analyst", obj("Firm", "firm-r"), GRANTS, ["firm-r"])).toBe(false);
    expect(canSee("analyst", obj("Firm", "firm-a"), GRANTS, ["firm-r"])).toBe(true);
    expect(canSee("analyst", obj("Mandate", "m-walled"), GRANTS, RESTRICTED)).toBe(true);
  });

  it("covers the compliance-only types and no others", () => {
    expect([...COMPLIANCE_ONLY_TYPES].sort()).toEqual(
      ["AccessLogEntry", "MandateAccess", "RestrictedFirm"].sort(),
    );
  });
});

describe("firmColumnOf", () => {
  it("ties the firm-scoped types to their firm, and no other", () => {
    for (const t of [
      "Firm",
      "ResearchFinding",
      "Extraction",
      "QualificationScore",
      "ReviewDecision",
      "DriftEvent",
      "MarketSignal",
      "SearchMembership",
    ] as const) {
      expect(firmColumnOf(t), t).toBe("firmId");
    }
    for (const t of [
      "Mandate",
      "Search",
      "SearchList",
      "ProposedRule",
      "RestrictedFirm",
    ] as const) {
      expect(firmColumnOf(t), t).toBeNull();
    }
  });
});

describe("need-to-know", () => {
  it("holds for compliance always, for a grant, and for a mandate nobody is granted", () => {
    expect(hasNeedToKnow("compliance", "m-walled", [])).toBe(true);
    expect(
      hasNeedToKnow("compliance", "m-walled", [{ mandateId: "m-walled", persona: "deal_lead" }]),
    ).toBe(true);
    expect(hasNeedToKnow("deal_lead", "m-walled", GRANTS)).toBe(true);
    expect(hasNeedToKnow("analyst", "m-walled", GRANTS)).toBe(false);
    expect(hasNeedToKnow("analyst", "m-open", GRANTS)).toBe(true);
    expect(hasNeedToKnow("analyst", "m-new", GRANTS)).toBe(true);
  });

  it("lists the walled mandates per persona", () => {
    expect([...walledMandateIds("analyst", GRANTS)]).toEqual(["m-walled"]);
    expect([...walledMandateIds("deal_lead", GRANTS)]).toEqual([]);
    expect([...walledMandateIds("compliance", GRANTS)]).toEqual([]);
  });

  it("hides restricted firms from every persona but compliance", () => {
    expect([...hiddenFirmsFor("analyst", ["a", "b"])]).toEqual(["a", "b"]);
    expect([...hiddenFirmsFor("deal_lead", ["a"])]).toEqual(["a"]);
    expect([...hiddenFirmsFor("compliance", ["a", "b"])]).toEqual([]);
  });
});

describe("redaction", () => {
  const mandate = {
    mandateId: "m-walled",
    title: "Sell-side of Acme Wealth",
    intentStatement: "Find advisers to sell Acme Wealth to a strategic buyer",
    codename: "Project Kestrel",
    archetype: "CF",
  };

  it("replaces the title with the codename and drops the intent, without need-to-know", () => {
    const out = redactMandate("analyst", mandate, "m-walled", GRANTS);
    expect(out.title).toBe("Project Kestrel");
    expect("intentStatement" in out).toBe(false);
    expect(out.archetype).toBe("CF");
    expect(JSON.stringify(out)).not.toContain("Acme");
  });

  it("leaves a mandate alone for a persona with need-to-know", () => {
    expect(redactMandate("deal_lead", mandate, "m-walled", GRANTS)).toBe(mandate);
    expect(redactMandate("compliance", mandate, "m-walled", GRANTS)).toBe(mandate);
  });

  it("derives a codename when the mandate has none, the same one every time", () => {
    const { codename: _drop, ...bare } = mandate;
    void _drop;
    const out = redactMandate("analyst", bare, "m-walled", GRANTS);
    expect(out.title).toBe(codenameFor("m-walled"));
    expect(codenameFor("m-walled")).toBe(codenameFor("m-walled"));
    expect(codenameFor("m-walled")).toMatch(/^Project [A-Z][a-z]+$/);
  });

  it("gives a new mandate a codename no other mandate holds", () => {
    const first = codenameFor("m-new");
    expect(uniqueCodename("m-new", new Set())).toBe(first);
    const second = uniqueCodename("m-new", new Set([first]));
    expect(second).not.toBe(first);
    expect(second).toMatch(/^Project [A-Z][a-z]+$/);
    expect(uniqueCodename("m-new", new Set([first]))).toBe(second);
    // Every word taken: numbered, still unique.
    const all = new Set<string>();
    for (let i = 0; i < 70; i += 1) {
      const name = uniqueCodename("m-new", all);
      expect(all.has(name)).toBe(false);
      all.add(name);
    }
    expect([...all].some((n) => /\d$/.test(n))).toBe(true);
  });

  it("renames a search and a list of a walled mandate but keeps the list suffix", () => {
    expect(redactDerivedName("Sell-side of Acme", "Project Kestrel")).toBe("Project Kestrel");
    // A name that still carries a run date (a database not yet migrated) gives nothing away either.
    expect(redactDerivedName("Sell-side of Acme · 2026-09-01", "Project Kestrel")).toBe(
      "Project Kestrel",
    );
    expect(redactDerivedName("Sell-side of Acme — universe", "Project Kestrel")).toBe(
      "Project Kestrel — universe",
    );
    expect(redactDerivedName("Anything else", "Project Kestrel")).toBe("Project Kestrel");
  });

  it("applies to the objects that carry a mandate's name", () => {
    const names = new Map([["m-walled", "Project Kestrel"]]);
    const search = {
      $apiName: "Search",
      $primaryKey: "s1",
      mandateId: "m-walled",
      name: "Sell-side of Acme",
    };
    expect(redactObject("analyst", search, GRANTS, names).name).toBe("Project Kestrel");
    expect(redactObject("deal_lead", search, GRANTS, names)).toBe(search);
    const other = { ...search, mandateId: "m-open" };
    expect(redactObject("analyst", other, GRANTS, names)).toBe(other);
    const firm = { $apiName: "Firm", $primaryKey: "firm-a", firmName: "Acme" };
    expect(redactObject("analyst", firm, GRANTS, names)).toBe(firm);
  });
});
