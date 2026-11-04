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
    expect(alters).toEqual([`ALTER TABLE firm ADD COLUMN "successionRisk" text`]);
    expect(repair.indexOf(`SET LOCAL lock_timeout = '5s'`)).toBeGreaterThanOrEqual(0);
    expect(repair.indexOf(`SET LOCAL lock_timeout = '5s'`)).toBeLessThan(repair.indexOf(alters[0]));
  });
});
