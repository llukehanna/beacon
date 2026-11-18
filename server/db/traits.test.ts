import { describe, expect, it } from "vitest";
import { loadTraits } from "../rubric/load.js";
import { createTestDb } from "../testing.js";
import type { Db } from "./client.js";
import { getObject, insertObject, listObjects } from "./repo.js";
import { appendTraitValues } from "./traits.js";

const AT = "2026-09-01T12:00:00.000Z";

async function bareFirm(): Promise<Db> {
  const db = await createTestDb();
  await insertObject(db, "Firm", { firmId: "f1", firmName: "Bare Advisors" });
  return db;
}

const revisions = (db: Db, traitKey: string) =>
  db.query<{ revision: number; valueNumber: number | null; sourceFindingId: string | null }>(
    `SELECT "revision", "valueNumber", "sourceFindingId" FROM firm_trait_value
      WHERE "firmId" = 'f1' AND "traitKey" = $1 ORDER BY "revision"`,
    [traitKey],
  );

describe("appendTraitValues", () => {
  it("numbers each trait's values 1, 2, ... even within one transaction", async () => {
    const db = await bareFirm();
    await db.transaction(async (tx) => {
      await appendTraitValues(tx, "f1", { employees: 12 }, { setBy: "seed", setAt: AT });
      await appendTraitValues(
        tx,
        "f1",
        { employees: 14, coverage_model: "Multi-sector" },
        { setBy: "analyst", setAt: AT, sourceFindingId: "finding-1" },
      );
    });
    expect(await revisions(db, "employees")).toEqual([
      { revision: 1, valueNumber: 12, sourceFindingId: null },
      { revision: 2, valueNumber: 14, sourceFindingId: "finding-1" },
    ]);
    expect(await revisions(db, "coverage_model")).toEqual([
      { revision: 1, valueNumber: null, sourceFindingId: "finding-1" },
    ]);
  });

  it("stores each kind in its own column", async () => {
    const db = await bareFirm();
    await appendTraitValues(
      db,
      "f1",
      { coverage_model: "Generalist", deal_size_usd_m: 40.5, solvent: true },
      { setBy: "seed", setAt: AT },
    );
    expect(
      await db.query(
        `SELECT "traitKey", "valueString", "valueNumber", "valueBoolean" FROM firm_trait_value ORDER BY 1`,
      ),
    ).toEqual([
      {
        traitKey: "coverage_model",
        valueString: "Generalist",
        valueNumber: null,
        valueBoolean: null,
      },
      { traitKey: "deal_size_usd_m", valueString: null, valueNumber: 40.5, valueBoolean: null },
      { traitKey: "solvent", valueString: null, valueNumber: null, valueBoolean: true },
    ]);
  });

  it("refuses an unknown trait or a value of the wrong kind, naming the trait, and writes nothing", async () => {
    const db = await bareFirm();
    const opts = { setBy: "seed", setAt: AT };
    await expect(appendTraitValues(db, "f1", { employees: 3, headcount: 3 }, opts)).rejects.toThrow(
      /headcount/,
    );
    await expect(appendTraitValues(db, "f1", { employees: "many" }, opts)).rejects.toThrow(
      /employees/,
    );
    await expect(appendTraitValues(db, "f1", { solvent: "yes" }, opts)).rejects.toThrow(/solvent/);
    await expect(appendTraitValues(db, "f1", { coverage_model: 2 }, opts)).rejects.toThrow(
      /coverage_model/,
    );
    expect(await db.query(`SELECT * FROM firm_trait_value`)).toEqual([]);
  });

  it("refuses a fraction for a trait the catalog counts in whole numbers, and writes nothing", async () => {
    const db = await bareFirm();
    const opts = { setBy: "seed", setAt: AT };
    await expect(
      appendTraitValues(db, "f1", { deal_size_usd_m: 40.5, employees: 9.5 }, opts),
    ).rejects.toThrow(/employees/);
    expect(await db.query(`SELECT * FROM firm_trait_value`)).toEqual([]);
    await appendTraitValues(db, "f1", { deal_size_usd_m: 40.5, employees: 9 }, opts);
    expect(await revisions(db, "employees")).toEqual([
      { revision: 1, valueNumber: 9, sourceFindingId: null },
    ]);
  });

  it("is append-only: a stored value is never updated or deleted", async () => {
    const db = await bareFirm();
    await appendTraitValues(db, "f1", { employees: 12 }, { setBy: "seed", setAt: AT });
    await expect(db.query(`UPDATE firm_trait_value SET "valueNumber" = 13`)).rejects.toThrow(
      "firm_trait_value is append-only",
    );
    await expect(db.query(`DELETE FROM firm_trait_value`)).rejects.toThrow(
      "firm_trait_value is append-only",
    );
  });
});

describe("reading firms", () => {
  it("takes each firm's traits from its latest trait values", async () => {
    const db = await createTestDb();
    await insertObject(db, "Firm", { firmId: "f1", firmName: "Stale Advisors" });
    await appendTraitValues(
      db,
      "f1",
      { employees: 30, solvent: true },
      { setBy: "seed", setAt: AT },
    );
    await appendTraitValues(db, "f1", { employees: 31 }, { setBy: "analyst", setAt: AT });
    await insertObject(db, "Firm", { firmId: "f2", firmName: "Empty Advisors" });
    expect((await getObject(db, "Firm", "f1"))?.traits).toEqual({ employees: 31, solvent: true });
    const page = await listObjects(db, "Firm", { orderBy: { firmName: "asc" } });
    expect(page.data.map((f) => [f.$primaryKey, f.traits])).toEqual([
      ["f2", {}],
      ["f1", { employees: 31, solvent: true }],
    ]);
  });

  it("drops a trait whose latest value cleared it", async () => {
    const db = await bareFirm();
    await appendTraitValues(db, "f1", { employees: 30 }, { setBy: "seed", setAt: AT });
    await appendTraitValues(db, "f1", { employees: null }, { setBy: "analyst", setAt: AT });
    expect((await getObject(db, "Firm", "f1"))?.traits).toEqual({});
  });
});

describe("locking a firm", () => {
  /** A Queryable over `db` that keeps every statement it runs. */
  const recording = (db: Db) => {
    const sql: string[] = [];
    return {
      sql,
      q: {
        query: <T>(text: string, params?: unknown[]) => {
          sql.push(text);
          return db.query<T>(text, params);
        },
      },
    };
  };

  it("takes the lock before reading traits, so a waiter reads the traits the lock holder committed", async () => {
    // Under READ COMMITTED a statement that waited for a row lock re-reads only the locked row; a
    // subquery in the same statement keeps the snapshot from before the wait. The traits must come
    // from a statement run after the lock is held.
    const db = await bareFirm();
    await appendTraitValues(db, "f1", { employees: 30 }, { setBy: "seed", setAt: AT });
    const { sql, q } = recording(db);
    const firm = await getObject(q, "Firm", "f1", { forUpdate: true });
    expect(firm?.traits).toEqual({ employees: 30 });
    const lock = sql.findIndex((s) => /FOR UPDATE/.test(s));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(sql[lock]).not.toMatch(/firm_trait_current/);
    expect(sql.findIndex((s, i) => i > lock && /firm_trait_current/.test(s))).toBeGreaterThan(lock);
  });
});

describe("the trait catalog", () => {
  it("says which number traits count whole things", async () => {
    const db = await createTestDb();
    const traits = await loadTraits(db);
    expect(traits.filter((t) => t.wholeNumber).map((t) => t.traitKey)).toEqual([
      "firm_age",
      "fee_generating_count",
      "geo_score",
      "employees",
    ]);
    expect(traits.every((t) => !t.wholeNumber || t.kind === "number")).toBe(true);
  });
});
