import { describe, expect, it } from "vitest";
import { OWNERSHIP_TYPES, REVENUE_BANDS, SUCCESSION_RISKS } from "../../shared/vocab.js";
import { createTestDb } from "../testing.js";
import { resetDemo } from "./reset.js";
import { generateUniverse } from "./universe.js";

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
    expect(
      await n(
        `SELECT count(*)::int AS n FROM drift_event WHERE "driftStatus" = 'open' AND "driftReason" IN ('tier_moved','pass_reason_invalidated')`,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM drift_event WHERE "driftReason" = 'outcome_diverged' AND "driftStatus" = 'resolved'`,
      ),
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
