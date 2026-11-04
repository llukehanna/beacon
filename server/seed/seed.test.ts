import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OWNERSHIP_TYPES, REVENUE_BANDS, SUCCESSION_RISKS } from "../../shared/vocab.js";
import { createTestDb } from "../testing.js";
import { resetDemo } from "./reset.js";
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
