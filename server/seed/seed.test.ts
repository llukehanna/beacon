import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ObjectOf } from "../../shared/schema.js";
import { OWNERSHIP_TYPES, REVENUE_BANDS, SUCCESSION_RISKS } from "../../shared/vocab.js";
import { type ClusteringFixture, fixtureClusterer, hashRejections } from "../clustering/fixture.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer, RejectionRow } from "../clustering/types.js";
import type { FindingPlan } from "../enrichment/reconcile.js";
import { createTestDb } from "../testing.js";
import { resetDemo } from "./reset.js";
import { SHOWCASE_COUNT, pickShowcaseFirms } from "./showcase.js";
import { PLACES, RESERVED_WORDS, SURNAMES, generateUniverse } from "./universe.js";

describe("generateUniverse", () => {
  it("is deterministic, unique, and roughly 10% CS", () => {
    const a = generateUniverse();
    expect(a).toEqual(generateUniverse());
    expect(new Set(a.map((f) => f.firmId)).size).toBe(700);
    const cs = a.filter((f) => f.firmType === "CS").length;
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

  it("draws on at least 60 surnames and 30 place words", () => {
    expect(new Set(SURNAMES).size).toBeGreaterThanOrEqual(60);
    expect(new Set(PLACES).size).toBeGreaterThanOrEqual(30);
  });

  it("is unique across the universe", () => {
    expect(names).toHaveLength(700);
    expect(new Set(names).size).toBe(700);
  });

  it("builds every name in exactly one of the four house styles", () => {
    const surname = `(?:${SURNAMES.join("|")})`;
    const place = `(?:${PLACES.join("|")})`;
    const styles: Record<string, RegExp> = {
      partnership: new RegExp(`^${surname} & ${surname}(?: Partners| Advisory| Advisors)?$`),
      trio: new RegExp(`^${surname}, ${surname} & ${surname}(?: Partners)?$`),
      surname: new RegExp(
        `^${surname} (?:Advisory|Advisors|Partners|Capital Partners|& Co\\.|Group|Corporate Finance|Securities)$`,
      ),
      place: new RegExp(
        `^${place} (?:Capital Partners|Capital|Advisors|Advisory|Partners|Group|Securities)$`,
      ),
    };
    const counts: Record<string, number> = {};
    for (const n of names) {
      const matching = Object.keys(styles).filter((k) => styles[k].test(n));
      expect(matching, n).toHaveLength(1);
      counts[matching[0]] = (counts[matching[0]] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(["partnership", "place", "surname", "trio"]);
    for (const [style, count] of Object.entries(counts)) {
      expect(count, style).toBeGreaterThanOrEqual(70);
    }
  });

  it("never uses a name belonging to a well-known bank, broker or adviser", () => {
    const reserved = new Set(RESERVED_WORDS.map((w) => w.toLowerCase()));
    expect(reserved.size).toBeGreaterThanOrEqual(60);
    for (const w of [...SURNAMES, ...PLACES]) {
      expect(reserved.has(w.toLowerCase()), w).toBe(false);
    }
    for (const n of names) {
      for (const w of n.split(/[^A-Za-z]+/).filter(Boolean)) {
        expect(reserved.has(w.toLowerCase()), `${n} / ${w}`).toBe(false);
      }
    }
  });

  it("does not let any one first word dominate", () => {
    const counts = new Map<string, number>();
    for (const n of names) {
      const first = n.split(" ")[0];
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    const [word, most] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(most / names.length, word).toBeLessThanOrEqual(0.03);
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
      expect(REVENUE_BANDS).toContain(f.revenueBand);
      expect(OWNERSHIP_TYPES).toContain(f.ownership);
      expect(SUCCESSION_RISKS).toContain(f.successionRisk);
    }
  });

  it("spreads ownership across all types, with subsidiaries rare", () => {
    for (const o of OWNERSHIP_TYPES) {
      expect(
        firms.some((f) => f.ownership === o),
        o,
      ).toBe(true);
    }
    const subs = firms.filter((f) => f.ownership === "Subsidiary").length;
    expect(subs / firms.length).toBeLessThanOrEqual(0.1);
  });

  it("puts larger firms in higher revenue bands", () => {
    const large = firms.filter((f) => (f.employees ?? 0) > 200);
    expect(large.length).toBeGreaterThanOrEqual(3);
    const top = large.filter(
      (f) => f.revenueBand === "$50–100M" || f.revenueBand === ">$100M",
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
    expect(await n(`SELECT count(*)::int AS n FROM mandate`)).toBe(3);
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

    await resetDemo(db, now); // idempotent: truncates and rebuilds
    expect(await n(`SELECT count(*)::int AS n FROM firm`)).toBe(700);
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
      `SELECT count(*)::int AS cs FROM firm WHERE "firmId" = ANY($1) AND "firmType" = 'CS'`,
      [[...byFirm.keys()]],
    );
    expect(cs).toBeGreaterThanOrEqual(3);
    expect(open.filter((f) => (f.sourceUrl ?? "").includes(".example"))).toEqual([]);
    // Still in the live queue: not screened out, untouched by the earlier steps.
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM firm
        WHERE "firmId" = ANY($1) AND ("lifecycleState" <> 'Screening' OR employees < 10)`,
      [[...byFirm.keys()]],
    );
    expect(n).toBe(0);
  }, 300_000);

  it("approves the best-supported rule when the clusterer proposes no employees rule", async () => {
    const db = await createTestDb();
    const noEmployees: Clusterer = async (rows) => {
      const out = await heuristicClusterer(rows);
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
        return heuristicClusterer(rows);
      };
      await resetDemo(db, now, { clusterer: capture });
      return captured;
    };
    const first = await seed(new Date("2026-09-22T12:00:00.000Z"));
    const second = await seed(new Date("2031-03-05T08:30:00.000Z"));
    expect(first.length).toBeGreaterThan(0);
    expect(first.map((r) => r.decisionId)).toEqual(second.map((r) => r.decisionId));
    expect(hashRejections(second)).toBe(hashRejections(first));

    const recorded: ClusteringFixture = {
      inputHash: hashRejections(first),
      model: "claude-opus-5",
      proposals: [],
      createdAt: "2026-11-04T00:00:00.000Z",
    };
    const replay = fixtureClusterer(recorded, heuristicClusterer);
    expect((await replay(second)).source).toBe("claude");
  }, 300_000);
});

describe("pickShowcaseFirms", () => {
  const firm = (id: string, over: Partial<ObjectOf<"Firm">> = {}): ObjectOf<"Firm"> => ({
    $apiName: "Firm",
    $primaryKey: id,
    firmId: id,
    firmType: "CF",
    lifecycleState: "Discovered",
    employees: 30,
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
      firm("small", { employees: 9 }),
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

  it("includes at least three CS firms when that many are eligible", () => {
    const richCf = Array.from({ length: 5 }, (_, i) => firm(`cf${i}`));
    const cs = Array.from({ length: 4 }, (_, i) => firm(`cs${i}`, { firmType: "CS" }));
    const plans = (f: ObjectOf<"Firm">) =>
      f.firmType === "CS" ? [plan({}), abstain] : [...conflicts(2), abstain];
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
