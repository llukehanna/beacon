import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADVISORY_ACQUISITIONS, RUBRIC_ID } from "../../shared/workspaces/advisoryAcquisitions.js";
import type { Db } from "../db/client.js";
import { getObject, listObjects } from "../db/repo.js";
import { STRONG_CF, createTestDb, seedFirm } from "../testing.js";
import { loadActiveRubric, loadTraits } from "./load.js";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

describe("the stored catalog and rubric", () => {
  it("loads the seeded rubric and the catalog in order", async () => {
    const r = await loadActiveRubric(db);
    expect(r.rubricId).toBe(RUBRIC_ID);
    expect(r.definition).toEqual(ADVISORY_ACQUISITIONS.rubric);
    expect(await loadTraits(db)).toEqual(ADVISORY_ACQUISITIONS.traits);
  });

  it("allows one active rubric per workspace", async () => {
    await expect(
      db.query(
        `INSERT INTO rubric ("rubricId","workspaceKey","version","name","active","definitionJson","createdBy","createdAt")
         VALUES ('advisory-acquisitions@2','advisory-acquisitions',2,'v2',true,'{}','test','2026-09-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it("never rewrites a published rubric version", async () => {
    await expect(
      db.query(`UPDATE rubric SET "definitionJson" = '{}' WHERE "rubricId" = $1`, [RUBRIC_ID]),
    ).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM rubric WHERE "rubricId" = $1`, [RUBRIC_ID])).rejects.toThrow(
      /append-only/,
    );
    await db.query(`UPDATE rubric SET "active" = false WHERE "rubricId" = $1`, [RUBRIC_ID]);
    await expect(loadActiveRubric(db)).rejects.toThrow(/active rubric/);
  });
});

describe("a firm's derived traits", () => {
  it("are attached to every firm read, keyed by trait", async () => {
    const f = await seedFirm(db, STRONG_CF);
    const got = await getObject(db, "Firm", f.$primaryKey);
    expect(got?.traits?.deal_size_usd_m).toBe(200);
    expect(got?.traits?.coverage_model).toBe("Single-sector focus");
    const page = await listObjects(db, "Firm", { where: { firmId: { $eq: f.$primaryKey } } });
    const listed = page.data[0];
    expect(listed.traits).toEqual(got?.traits);
  });

  it("cannot be filtered on like a column", async () => {
    await expect(listObjects(db, "Firm", { where: { traits: { $eq: "x" } } })).rejects.toThrow(
      /Unknown property "traits"/,
    );
  });
});
