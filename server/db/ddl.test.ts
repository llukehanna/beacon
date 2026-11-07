import { describe, expect, it } from "vitest";
import { resetDemo } from "../seed/reset.js";
import { type Db, createPgliteDb } from "./client.js";
import { ensureSchema } from "./ddl.js";
import { getMeta } from "./meta.js";

const firmColumns = async (db: Db): Promise<string[]> =>
  (
    await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'firm'`,
    )
  ).map((r) => r.column_name);

/** The statements a Db sees, in order, including those inside transactions. */
function spied(db: Db, log: string[]): Db {
  return {
    ...db,
    query: (sql, params) => (log.push(sql), db.query(sql, params)),
    exec: (sql) => (log.push(sql), db.exec(sql)),
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({ query: (sql, params) => (log.push(sql), tx.query(sql, params)) }),
      ),
  };
}

describe("ensureSchema", () => {
  it("adds columns introduced after a table was created", async () => {
    const db = await createPgliteDb();
    await ensureSchema(db);
    // A database created before Firm.revenueBand and Firm.ownership existed.
    await db.exec(`ALTER TABLE firm DROP COLUMN "revenueBand", DROP COLUMN "ownership"`);
    expect(await firmColumns(db)).not.toContain("revenueBand");

    await ensureSchema(db);
    expect(await firmColumns(db)).toEqual(expect.arrayContaining(["revenueBand", "ownership"]));

    await expect(resetDemo(db, new Date("2026-09-01T12:00:00Z"))).resolves.toMatchObject({
      firms: 700,
    });
    expect(await getMeta(db, "lastResetAt")).not.toBeNull();
  });

  it("adds ProposedRule.proposedAt to a proposed_rule table created without it", async () => {
    const db = await createPgliteDb();
    await ensureSchema(db);
    await db.exec(`ALTER TABLE proposed_rule DROP COLUMN "proposedAt"`);
    await db.exec(
      `INSERT INTO proposed_rule ("proposedRuleId", "ruleStatus") VALUES ('rule-old', 'pending')`,
    );

    await ensureSchema(db);
    const [row] = await db.query<{ proposedAt: Date | null }>(
      `SELECT "proposedAt" FROM proposed_rule WHERE "proposedRuleId" = 'rule-old'`,
    );
    expect(row.proposedAt, "an existing row keeps its place and has no time").toBeNull();
    const [{ data_type }] = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'proposed_rule' AND column_name = 'proposedAt'`,
    );
    expect(data_type).toBe("timestamp with time zone");
  });

  it("creates the market_signal table and its due index on a database that lacks them", async () => {
    const db = await createPgliteDb();
    await ensureSchema(db);
    await db.exec(`DROP TABLE market_signal`);
    await ensureSchema(db);
    await db.query(
      `INSERT INTO market_signal ("signalId", "firmId", "kind", "effectiveDate") VALUES ('s1', 'f1', 'departure', now())`,
    );
    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'market_signal' ORDER BY indexname`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(["market_signal_due", "market_signal_firm", "market_signal_pkey"]),
    );
    // A second start changes nothing.
    await expect(ensureSchema(db)).resolves.toBeUndefined();
  });

  it("is idempotent", async () => {
    const db = await createPgliteDb();
    await ensureSchema(db);
    await expect(ensureSchema(db)).resolves.toBeUndefined();
  });

  it("runs no ALTER on an up-to-date schema, and a bounded one when a column is missing", async () => {
    const db = await createPgliteDb();
    await ensureSchema(db);

    const steady: string[] = [];
    await ensureSchema(spied(db, steady));
    expect(steady.filter((s) => /\bALTER\b/i.test(s))).toEqual([]);

    await db.exec(`ALTER TABLE firm DROP COLUMN "successionRisk"`);
    const repair: string[] = [];
    await ensureSchema(spied(db, repair));
    const alters = repair.filter((s) => /\bALTER\b/i.test(s));
    expect(alters).toEqual([`ALTER TABLE firm ADD COLUMN IF NOT EXISTS "successionRisk" text`]);
    expect(repair.indexOf(`SET LOCAL lock_timeout = '5s'`)).toBeGreaterThanOrEqual(0);
    expect(repair.indexOf(`SET LOCAL lock_timeout = '5s'`)).toBeLessThan(repair.indexOf(alters[0]));
  });
});
