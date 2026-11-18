import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toScreeningRules } from "../../shared/activeScreening.js";
import type { ObjectOf } from "../../shared/schema.js";
import { scoreFirm } from "../../shared/scoring.js";
import { STRONG_SHOWCASE_FIRM_IDS, TOUR_FIRM_ID } from "../../shared/showcaseFirms.js";
import { ADVISORY_ACQUISITIONS } from "../../shared/workspaces/advisoryAcquisitions.js";
import {
  OWNERSHIP_TYPES,
  REVENUE_BANDS,
  SUCCESSION_RISKS,
} from "../../shared/workspaces/advisoryVocab.js";
import { type ClusteringFixture, fixtureClusterer, hashRejections } from "../clustering/fixture.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer, RejectionRow } from "../clustering/types.js";
import { listAll } from "../db/repo.js";
import type { FindingPlan } from "../enrichment/reconcile.js";
import { TEST_RUBRIC, createTestDb } from "../testing.js";
import { RESTRICTED_FIRM_COUNT, RESTRICTION_REASONS, WALLED_MANDATE } from "./barriers.js";
import { resetDemo } from "./reset.js";
import { SHOWCASE_COUNT, isScreened, pickShowcaseFirms, runProfile } from "./showcase.js";
import {
  GIVEN_NAMES,
  LEGAL_FORMS,
  MAX_STEM_USES,
  NAME_STYLES,
  NAME_SUFFIXES,
  PLACES,
  RESERVED_WORDS,
  SURNAMES,
  generateUniverse,
  stemsOf,
} from "./universe.js";

describe("generateUniverse", () => {
  it("is deterministic, unique, and roughly 10% CS", () => {
    const a = generateUniverse();
    expect(a).toEqual(generateUniverse());
    expect(new Set(a.map((f) => f.firmId)).size).toBe(700);
    const cs = a.filter((f) => f.thesis === "CS").length;
    expect(cs).toBeGreaterThan(40);
    expect(cs).toBeLessThan(110);
  });
});

/** The invented-word stems the first generator glued together; names must no longer look like them. */
// prettier-ignore
const RETIRED_STEMS = [
  "Brevarre", "Calthorn", "Dellaway", "Elsworthy", "Farrowgate", "Gannister", "Halvercroft",
  "Istrenne", "Jorvane", "Kellmarsh", "Loxbury", "Morrendale", "Nethercote", "Orlanne",
  "Pellingham", "Quarrington", "Rathmore", "Sallowfield", "Tarrenvale", "Ulverdane",
  "Vessington", "Wexcombe", "Yardleigh", "Zennormoor", "Ambercroft", "Bellhaven", "Corrivale",
  "Dunstanmere", "Eversholt", "Fallowmere", "Glenharrow", "Hollinsby", "Ivorwick", "Kestermoor",
  "Lanworth", "Mirrowdale", "Northwold", "Oakenvale", "Pennarth", "Ravenmere",
];

describe("firm names", () => {
  const names = generateUniverse().map((f) => f.firmName!);

  const stems = new Set([...SURNAMES, ...GIVEN_NAMES, ...PLACES]);

  it("draws on wide word lists", () => {
    expect(new Set(SURNAMES).size).toBeGreaterThanOrEqual(500);
    expect(new Set(GIVEN_NAMES).size).toBeGreaterThanOrEqual(80);
    expect(new Set(PLACES).size).toBeGreaterThanOrEqual(180);
    // No word is in two lists, so each stem is counted once.
    expect(stems.size).toBe(SURNAMES.length + GIVEN_NAMES.length + PLACES.length);
  });

  it("is unique across the universe", () => {
    expect(names).toHaveLength(700);
    expect(new Set(names).size).toBe(700);
  });

  it("uses no stem in more than two names, and never leads two names with the same word", () => {
    const uses = new Map<string, number>();
    const firstWords = new Set<string>();
    for (const n of names) {
      const own = stemsOf(n, stems);
      expect(own.length, n).toBeGreaterThanOrEqual(1);
      expect(n.startsWith(own[0]), n).toBe(true);
      for (const s of own) {
        uses.set(s, (uses.get(s) ?? 0) + 1);
      }
      // So no two names differ only by suffix ("Bramblemoor Group", "Bramblemoor Capital").
      expect(firstWords.has(own[0]), n).toBe(false);
      firstWords.add(own[0]);
    }
    for (const [stem, count] of uses) {
      expect(count, stem).toBeLessThanOrEqual(MAX_STEM_USES);
    }
  });

  it("builds every name in exactly one of the five house styles", () => {
    const alt = (xs: readonly string[]) =>
      `(?:${[...xs]
        .sort((a, b) => b.length - a.length)
        .map((x) => x.replace(/[.&]/g, "\\$&"))
        .join("|")})`;
    const surname = alt(SURNAMES);
    const tail = (style: keyof typeof NAME_SUFFIXES) =>
      `(?: ${alt(NAME_SUFFIXES[style].filter(Boolean))})?(?: ${alt(Object.values(LEGAL_FORMS))})?$`;
    const styles: Record<string, RegExp> = {
      partnership: new RegExp(`^${surname} & ${surname}${tail("partnership")}`),
      trio: new RegExp(`^${surname}, ${surname} & ${surname}${tail("trio")}`),
      surname: new RegExp(`^${surname}${tail("surname")}`),
      founder: new RegExp(`^${alt(GIVEN_NAMES)} ${surname}${tail("founder")}`),
      place: new RegExp(`^${alt(PLACES)}${tail("place")}`),
    };
    const counts: Record<string, number> = {};
    for (const n of names) {
      const matching = Object.keys(styles).filter((k) => styles[k].test(n));
      expect(matching, n).toHaveLength(1);
      counts[matching[0]] = (counts[matching[0]] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual([...NAME_STYLES].sort());
    for (const [style, count] of Object.entries(counts)) {
      expect(count, style).toBeGreaterThanOrEqual(40);
    }
  });

  it("never uses a name belonging to a well-known bank, broker or adviser", () => {
    const reserved = new Set(RESERVED_WORDS.map((w) => w.toLowerCase()));
    expect(reserved.size).toBeGreaterThanOrEqual(60);
    for (const w of stems) {
      expect(reserved.has(w.toLowerCase()), w).toBe(false);
    }
    for (const n of names) {
      for (const w of n.split(/[^A-Za-z]+/).filter(Boolean)) {
        expect(reserved.has(w.toLowerCase()), `${n} / ${w}`).toBe(false);
      }
    }
  });

  it("no longer contains the retired invented stems", () => {
    for (const n of names) {
      for (const stem of RETIRED_STEMS) {
        expect(n.includes(stem), `${n} / ${stem}`).toBe(false);
      }
    }
  });

  it("passes the repo sanitizer", () => {
    const dir = mkdtempSync(join(tmpdir(), "beacon-names-"));
    try {
      writeFileSync(join(dir, "names.txt"), names.join("\n"));
      const run = spawnSync(
        process.execPath,
        [join(process.cwd(), "scripts/check-sanitized.mjs")],
        { cwd: dir, encoding: "utf8" },
      );
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("generateUniverse profile fields", () => {
  const firms = generateUniverse();

  it("gives every firm a revenue band, ownership type and succession risk from the vocab", () => {
    for (const f of firms) {
      expect(REVENUE_BANDS).toContain(f.traits.revenue_band);
      expect(OWNERSHIP_TYPES).toContain(f.traits.ownership);
      expect(SUCCESSION_RISKS).toContain(f.traits.succession_risk);
    }
  });

  it("spreads ownership across all types, with subsidiaries rare", () => {
    for (const o of OWNERSHIP_TYPES) {
      expect(
        firms.some((f) => f.traits.ownership === o),
        o,
      ).toBe(true);
    }
    const subs = firms.filter((f) => f.traits.ownership === "Subsidiary").length;
    expect(subs / firms.length).toBeLessThanOrEqual(0.1);
  });

  it("puts larger firms in higher revenue bands", () => {
    const large = firms.filter((f) => Number(f.traits.employees ?? 0) > 200);
    expect(large.length).toBeGreaterThanOrEqual(3);
    const top = large.filter(
      (f) => f.traits.revenue_band === "$50–100M" || f.traits.revenue_band === ">$100M",
    ).length;
    expect(top / large.length).toBeGreaterThanOrEqual(0.6);
  });
});

describe("resetDemo", () => {
  it("builds a lived-in demo through the real actions", async () => {
    const db = await createTestDb();
    const now = new Date("2026-09-22T12:00:00.000Z");
    await resetDemo(db, now);
    const n = async (sql: string) => (await db.query<{ n: number }>(sql))[0].n;

    expect(await n(`SELECT count(*)::int AS n FROM firm`)).toBe(700);
    // Every firm keeps its traits as trait values and its thesis in `thesis`.
    expect(await n(`SELECT count(*)::int AS n FROM firm WHERE "thesis" IS NULL`)).toBe(0);
    expect(await n(`SELECT count(DISTINCT "firmId")::int AS n FROM firm_trait_value`)).toBe(700);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM firm WHERE "lifecycleState" IN ('Qualified','Outreach','NDA','IOI','LOI','Closed')`,
      ),
    ).toBeGreaterThanOrEqual(6);
    for (const stage of ["Outreach", "NDA", "IOI", "LOI", "Closed"]) {
      expect(
        await n(`SELECT count(*)::int AS n FROM firm WHERE "lifecycleState" = '${stage}'`),
        stage,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(
      await n(`SELECT count(*)::int AS n FROM firm WHERE "lifecycleState" = 'Passed'`),
    ).toBeGreaterThanOrEqual(20);
    // Observed outcomes never run ahead of the funnel stage.
    expect(
      await n(
        `SELECT count(*)::int AS n FROM firm WHERE outcome IN ('loi','closed') AND "lifecycleState" IN ('Qualified','Outreach','NDA','IOI')`,
      ),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM firm WHERE "lifecycleState" = 'Closed' AND outcome IS DISTINCT FROM 'closed'`,
      ),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM firm WHERE "lifecycleState" = 'Passed' AND outcome = 'acquired_by_competitor'`,
      ),
    ).toBeGreaterThanOrEqual(1);
    // The three the history makes, and the walled one the information barrier adds last.
    expect(await n(`SELECT count(*)::int AS n FROM mandate`)).toBe(4);
    expect(await n(`SELECT count(*)::int AS n FROM search`)).toBe(2);
    expect(await n(`SELECT count(*)::int AS n FROM search_list_firm`)).toBeGreaterThan(0);
    expect(
      await n(`SELECT count(*)::int AS n FROM proposed_rule WHERE "ruleStatus" = 'pending'`),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await n(`SELECT count(*)::int AS n FROM proposed_rule WHERE "ruleStatus" = 'approved'`),
    ).toBe(1);
    expect(await n(`SELECT count(*)::int AS n FROM hard_screen_config WHERE "configActive"`)).toBe(
      1,
    );
    for (const reason of ["tier_moved", "pass_reason_invalidated", "outcome_diverged"]) {
      expect(
        await n(
          `SELECT count(*)::int AS n FROM drift_event WHERE "driftStatus" = 'open' AND "driftReason" = '${reason}'`,
        ),
        reason,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(
      await n(`SELECT count(*)::int AS n FROM drift_event WHERE "driftStatus" = 'resolved'`),
    ).toBe(1);
    expect(
      await n(`SELECT count(*)::int AS n FROM research_finding WHERE "findingStatus" = 'verified'`),
    ).toBeGreaterThanOrEqual(100);
    expect(
      await n(`SELECT count(*)::int AS n FROM research_finding WHERE "findingStatus" = 'rejected'`),
    ).toBeGreaterThanOrEqual(5);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM research_finding WHERE "findingStatus" = 'abstained'`,
      ),
    ).toBeGreaterThanOrEqual(10);
    const [{ last }] = await db.query<{ last: Date }>(
      `SELECT max("decidedAt") AS last FROM review_decision`,
    );
    expect(new Date(last).getTime()).toBeLessThan(now.getTime());

    // The information barrier: three restricted firms nothing else touched, a codename on every
    // mandate, and grants that leave exactly one mandate closed to the analyst.
    const restricted = await db.query<{ firmId: string; reason: string }>(
      `SELECT "firmId", "reason" FROM restricted_firm ORDER BY "addedAt" DESC`,
    );
    expect(restricted.map((r) => r.reason)).toEqual([...RESTRICTION_REASONS]);
    const ids = restricted.map((r) => r.firmId);
    expect(ids).toHaveLength(RESTRICTED_FIRM_COUNT);
    for (const table of [
      "research_finding",
      "review_decision",
      "drift_event",
      "market_signal",
      "qualification_score",
      "search_membership",
    ]) {
      expect(
        await n(
          `SELECT count(*)::int AS n FROM ${table} WHERE "firmId" = ANY('{${ids.join(",")}}')`,
        ),
        table,
      ).toBe(0);
    }
    expect(
      await n(
        `SELECT count(*)::int AS n FROM firm WHERE "firmId" = ANY('{${ids.join(",")}}') AND "lifecycleState" = 'Discovered' AND "enrichedBy" IS NULL`,
      ),
    ).toBe(RESTRICTED_FIRM_COUNT);
    const codenames = await db.query<{ mandateId: string; title: string; codename: string }>(
      `SELECT "mandateId", "title", "codename" FROM mandate ORDER BY "createdAt", "mandateId"`,
    );
    expect(codenames.every((m) => /^Project [A-Z][a-z]+$/.test(m.codename))).toBe(true);
    expect(new Set(codenames.map((m) => m.codename)).size).toBe(4);
    const walled = codenames.find((m) => m.codename === WALLED_MANDATE.codename)!;
    expect(walled.title).toBe(WALLED_MANDATE.title);
    const grants = await db.query<{ mandateId: string; persona: string }>(
      `SELECT "mandateId", "persona" FROM mandate_access`,
    );
    const personasOf = (id: string) =>
      grants
        .filter((g) => g.mandateId === id)
        .map((g) => g.persona)
        .sort();
    for (const m of codenames) {
      expect(personasOf(m.mandateId), m.title).toEqual(
        m.mandateId === walled.mandateId
          ? ["compliance", "deal_lead"]
          : ["analyst", "compliance", "deal_lead"],
      );
    }
    // The access log starts empty: it records what happens while the demo runs.
    expect(await n(`SELECT count(*)::int AS n FROM access_log_entry`)).toBe(0);

    await resetDemo(db, now); // idempotent: truncates and rebuilds
    expect(await n(`SELECT count(*)::int AS n FROM firm`)).toBe(700);
    expect(
      (await db.query<{ firmId: string }>(`SELECT "firmId" FROM restricted_firm`))
        .map((r) => r.firmId)
        .sort(),
    ).toEqual([...ids].sort());
  }, 300_000);
});

describe("showcase seed", () => {
  it("the seed leaves showcase agent runs open", async () => {
    const db = await createTestDb();
    await resetDemo(db, new Date("2026-09-22T12:00:00.000Z"));
    const open = await db.query<{
      firmId: string;
      findingStatus: string;
      conflictGroupId: string | null;
      sourceQuote: string | null;
      sourceUrl: string | null;
    }>(
      `SELECT "firmId", "findingStatus", "conflictGroupId", "sourceQuote", "sourceUrl"
         FROM research_finding
        WHERE ("findingStatus" = 'abstained' OR ("findingStatus" = 'proposed' AND "extractionModel" IS NOT NULL))
          AND "firmId" IN (SELECT "firmId" FROM firm WHERE "enrichedBy" = 'agent')`,
    );
    const byFirm = new Map<string, typeof open>();
    for (const f of open) {
      byFirm.set(f.firmId, [...(byFirm.get(f.firmId) ?? []), f]);
    }
    expect(byFirm.size).toBeGreaterThanOrEqual(SHOWCASE_COUNT);
    expect(
      new Set(open.flatMap((f) => (f.conflictGroupId ? [f.conflictGroupId] : []))).size,
    ).toBeGreaterThanOrEqual(3);
    for (const [firm, findings] of byFirm) {
      expect(
        findings.some((f) => f.findingStatus === "abstained"),
        `${firm} abstained`,
      ).toBe(true);
      expect(
        findings.some((f) => f.findingStatus === "proposed" && f.sourceQuote),
        `${firm} proposed`,
      ).toBe(true);
    }
    const [{ cs }] = await db.query<{ cs: number }>(
      `SELECT count(*)::int AS cs FROM firm WHERE "firmId" = ANY($1) AND "thesis" = 'CS'`,
      [[...byFirm.keys()]],
    );
    expect(cs).toBeGreaterThanOrEqual(3);
    expect(open.filter((f) => (f.sourceUrl ?? "").includes(".example"))).toEqual([]);
    // Still in the live queue: not screened out, untouched by the earlier steps.
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM firm
        WHERE "firmId" = ANY($1)
          AND ("lifecycleState" <> 'Screening'
               OR "firmId" IN (SELECT "firmId" FROM firm_trait_current
                                WHERE "traitKey" = 'employees' AND "valueNumber" < 10))`,
      [[...byFirm.keys()]],
    );
    expect(n).toBe(0);
    // And not screened by the desk's own queue logic (base rules plus the approved rules), so
    // none sinks to the bottom of the queue.
    const rules = toScreeningRules(
      (await listAll(db, "ProposedRule")).map((p) => ({ ...p, proposedRuleId: p.$primaryKey })),
      await listAll(db, "HardScreenConfig"),
    );
    expect(rules.length).toBeGreaterThan(0);
    const firms = await listAll(db, "Firm");
    expect(byFirm.size).toBeGreaterThan(0);
    for (const id of byFirm.keys()) {
      const firm = firms.find((f) => f.$primaryKey === id)!;
      expect(isScreened(firm, rules), `${id} is hard-screened`).toBe(false);
    }

    // The strong firms, the tour's first among them: nearly complete, verified where it scores,
    // and worth a look. Still in the live queue, with a conflict and the gates left to the visitor.
    expect(STRONG_SHOWCASE_FIRM_IDS).toContain(TOUR_FIRM_ID);
    const findings = await listAll(db, "ResearchFinding");
    for (const id of STRONG_SHOWCASE_FIRM_IDS) {
      const firm = firms.find((f) => f.$primaryKey === id)!;
      expect(firm.lifecycleState, `${id} stage`).toBe("Screening");
      expect(isScreened(firm, rules), `${id} is hard-screened`).toBe(false);
      const run = runProfile(firm, findings);
      expect(run.conflicts, `${id} conflicts`).toBe(1);
      expect(run.abstained, `${id} abstentions`).toBeLessThanOrEqual(2);
      expect(run.verified, `${id} verified`).toBeGreaterThanOrEqual(3);
      expect(run.proposed + run.verified, `${id} values`).toBeGreaterThanOrEqual(6);
      expect(run.failingGates, `${id} failing gates`).toEqual([]);
      const live = scoreFirm(ADVISORY_ACQUISITIONS.rubric, firm);
      expect(live.hardRejected, `${id} rejected`).toBe(false);
      expect(["A", "B"], `${id} tier`).toContain(live.tier);
      expect(["A", "B"], `${id} tier if verified`).toContain(run.projected.tier);
    }
  }, 300_000);

  it("approves the best-supported rule when the clusterer proposes no employees rule", async () => {
    const db = await createTestDb();
    const noEmployees: Clusterer = async (rows) => {
      const out = await heuristicClusterer(rows, TEST_RUBRIC);
      return { ...out, proposals: out.proposals.filter((p) => p.predicateAxis !== "employees") };
    };
    await resetDemo(db, new Date("2026-09-22T12:00:00.000Z"), { clusterer: noEmployees });
    const rules = await db.query<{ predicateAxis: string; ruleStatus: string; n: number }>(
      `SELECT "predicateAxis", "ruleStatus", "supportingFirmCount" AS n FROM proposed_rule ORDER BY n DESC`,
    );
    expect(rules.some((r) => r.predicateAxis === "employees")).toBe(false);
    expect(rules.filter((r) => r.ruleStatus === "approved")).toHaveLength(1);
    expect(rules.find((r) => r.ruleStatus === "approved")!.n).toBe(rules[0].n);
  }, 300_000);

  it("clusters the same rejections on every seed, so a recorded reply keeps matching", async () => {
    const seed = async (now: Date) => {
      const db = await createTestDb();
      let captured: RejectionRow[] = [];
      const capture: Clusterer = async (rows) => {
        captured = [...rows];
        return heuristicClusterer(rows, TEST_RUBRIC);
      };
      await resetDemo(db, now, { clusterer: capture });
      return captured;
    };
    const first = await seed(new Date("2026-09-22T12:00:00.000Z"));
    const second = await seed(new Date("2031-03-05T08:30:00.000Z"));
    expect(first.length).toBeGreaterThan(0);
    expect(first.map((r) => r.decisionId)).toEqual(second.map((r) => r.decisionId));
    expect(hashRejections(second, TEST_RUBRIC)).toBe(hashRejections(first, TEST_RUBRIC));

    const recorded: ClusteringFixture = {
      inputHash: hashRejections(first, TEST_RUBRIC),
      model: "claude-opus-5",
      proposals: [],
      createdAt: "2026-11-04T00:00:00.000Z",
    };
    const replay = fixtureClusterer(recorded, heuristicClusterer);
    expect((await replay(second, TEST_RUBRIC)).source).toBe("claude");
  }, 300_000);
});

describe("pickShowcaseFirms", () => {
  const firm = (id: string, over: Partial<ObjectOf<"Firm">> = {}): ObjectOf<"Firm"> => ({
    $apiName: "Firm",
    $primaryKey: id,
    firmId: id,
    thesis: "CF",
    lifecycleState: "Discovered",
    traits: { employees: 30 },
    ...over,
  });
  const plan = (over: Partial<FindingPlan>): FindingPlan => ({
    axis: "a",
    value: "1",
    provider: "dealdb",
    sourceType: "database",
    sourceUrl: null,
    sourceExcerpt: "",
    sourceDocumentId: "d",
    sourceQuote: "q",
    extractionModel: "m",
    confidence: 0.9,
    confidenceTier: "high",
    findingStatus: "proposed",
    conflictGroupId: null,
    ...over,
  });
  const abstain = plan({ value: null, sourceQuote: null, findingStatus: "abstained" });
  const conflicts = (n: number): FindingPlan[] =>
    Array.from({ length: n }, (_, i) => plan({ conflictGroupId: `cg${i}` }));

  it("is deterministic and ranks by conflicts, then providers, then id", () => {
    const plans: Record<string, FindingPlan[]> = {
      c: [plan({}), abstain],
      b: [...conflicts(2), abstain],
      a: [plan({ provider: "dealdb+filings" }), abstain],
      d: [...conflicts(2), plan({ provider: "websearch" }), abstain],
    };
    const candidates = ["c", "b", "a", "d"].map((id) => firm(id));
    const pick = (list: ObjectOf<"Firm">[]) => pickShowcaseFirms(list, (f) => plans[f.$primaryKey]);
    expect(pick(candidates)).toEqual(["d", "b", "a", "c"]);
    expect(pick([...candidates].reverse())).toEqual(["d", "b", "a", "c"]);
    expect(pickShowcaseFirms(candidates, (f) => plans[f.$primaryKey], 2)).toEqual(["d", "b"]);
  });

  it("skips ineligible firms", () => {
    const both = [plan({}), abstain];
    const candidates = [
      firm("ok"),
      firm("small", { traits: { employees: 9 } }),
      firm("advanced", { lifecycleState: "Qualified" }),
      firm("touched", { enrichedBy: "agent" }),
      firm("only-values"),
      firm("only-abstains"),
    ];
    const plans: Record<string, FindingPlan[]> = {
      ok: both,
      small: both,
      advanced: both,
      touched: both,
      "only-values": [plan({})],
      "only-abstains": [abstain],
    };
    expect(pickShowcaseFirms(candidates, (f) => plans[f.$primaryKey])).toEqual(["ok"]);
  });

  it("skips firms the desk's queue would hard-screen", () => {
    const both = [plan({}), abstain];
    const rules = [
      {
        ruleId: "r1",
        axis: "employees",
        operator: "<",
        threshold: "40",
        model: "both",
        label: "employees < 40",
      },
    ];
    const candidates = [
      firm("ok", { traits: { employees: 50 } }),
      firm("rule-screened", { traits: { employees: 20 } }),
      firm("generalist", { traits: { employees: 50, coverage_model: "Generalist" } }),
    ];
    const pick = (r: typeof rules) => pickShowcaseFirms(candidates, () => both, 12, r);
    expect(pick(rules)).toEqual(["ok"]);
    // The generalist base rule applies with or without approved rules.
    expect(pick([])).toEqual(["ok", "rule-screened"]);
  });

  it("includes at least three CS firms when that many are eligible", () => {
    const richCf = Array.from({ length: 5 }, (_, i) => firm(`cf${i}`));
    const cs = Array.from({ length: 4 }, (_, i) => firm(`cs${i}`, { thesis: "CS" }));
    const plans = (f: ObjectOf<"Firm">) =>
      f.thesis === "CS" ? [plan({}), abstain] : [...conflicts(2), abstain];
    const picked = pickShowcaseFirms([...richCf, ...cs], plans, 5);
    expect(picked).toHaveLength(5);
    expect(picked.filter((id) => id.startsWith("cs"))).toEqual(["cs0", "cs1", "cs2"]);
    expect(picked.filter((id) => id.startsWith("cf"))).toEqual(["cf0", "cf1"]);
    // Fewer than three eligible: all of them are still included.
    expect(
      pickShowcaseFirms([...richCf, cs[0]], plans, 3).filter((id) => id.startsWith("cs")),
    ).toEqual(["cs0"]);
  });
});
