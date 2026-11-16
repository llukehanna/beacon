import { describe, expect, it } from "vitest";
import { createTestDb } from "../testing.js";
import type { Db } from "./client.js";
import { insertObject } from "./repo.js";
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
