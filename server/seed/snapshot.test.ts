import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "../../shared/schema.js";
import type { Db } from "../db/client.js";
import { getMeta } from "../db/meta.js";
import { EXTRACTION_PROMPT_VERSION, ruleBasedExtraction } from "../extraction/contract.js";
import { documentsHash, firmDocuments } from "../extraction/documents.js";
import type { FixtureRecord } from "../extraction/fixtures.js";
import { createTestDb } from "../testing.js";
import { resetDemo } from "./reset.js";
import { resetFromSnapshot, saveSnapshot } from "./snapshot.js";
import { generateUniverse } from "./universe.js";

/** Sequential ids, so two builds of the same history get the same primary keys. */
function sequentialIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

/** One valid record built from the rule-based output, so its quotes ground and it yields rows. */
function oneFixture(takenAt: Date): FixtureRecord {
  const firm = generateUniverse()[0];
  const docs = firmDocuments(firm);
  return {
    firmId: firm.firmId!,
    model: "claude-haiku-4-5",
    promptVersion: EXTRACTION_PROMPT_VERSION,
    documentsHash: documentsHash(docs),
    createdAt: takenAt.toISOString(),
    output: ruleBasedExtraction(docs),
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0,
    latencyMs: null,
    batchId: null,
  };
}

/** Every demo table, rows ordered by primary key. */
async function dump(db: Db): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of Object.values(OBJECT_TYPES)) {
    out[t.table] = await db.query(`SELECT * FROM ${t.table} ORDER BY "${t.primaryKey}"`);
  }
  out.search_list_firm = await db.query(
    `SELECT * FROM search_list_firm ORDER BY "searchId", "firmId"`,
  );
  return out;
}

describe("resetFromSnapshot", () => {
  it("produces exactly the rows a full rebuild would at that moment", async () => {
    // Taken at noon; restored 13 days later a moment before midnight, so dates in text roll over differently.
    const takenAt = new Date("2026-09-22T12:00:00.000Z");
    const later = new Date("2026-10-05T23:59:30.123Z");

    const restored = await createTestDb();
    const fixtures = [oneFixture(takenAt)];
    await resetDemo(restored, takenAt, { newId: sequentialIds(), fixtures });
    await saveSnapshot(restored, takenAt);
    // Visitors change things before the next reset; the snapshot must not care.
    await restored.query(`DELETE FROM review_decision`);
    await restored.query(`UPDATE firm SET "lifecycleState" = 'Passed'`);
    expect(await resetFromSnapshot(restored, later)).toEqual({ firms: 700 });

    const rebuilt = await createTestDb();
    await resetDemo(rebuilt, later, { newId: sequentialIds(), fixtures });

    const [a, b] = [await dump(restored), await dump(rebuilt)];
    expect(
      (b.extraction as unknown[]).length,
      "the fixture produced Extraction rows",
    ).toBeGreaterThan(0);
    for (const table of Object.keys(b)) {
      expect(a[table].length, table).toBe(b[table].length);
      expect(a[table], table).toEqual(b[table]);
    }
    const searches = b.search as { name: string }[];
    expect(searches.some((s) => s.name.endsWith(" · 2026-09-06"))).toBe(true);
    expect(await getMeta(restored, "lastResetAt")).toBe(later.toISOString());
  }, 300_000);

  it("restores a snapshot taken before a column existed, leaving it empty", async () => {
    const takenAt = new Date("2026-09-22T12:00:00.000Z");
    const db = await createTestDb();
    await resetDemo(db, takenAt, { newId: sequentialIds() });
    await saveSnapshot(db, takenAt);
    await db.exec(`ALTER TABLE snapshot_firm DROP COLUMN "successionRisk"`);
    await expect(resetFromSnapshot(db, takenAt)).resolves.toEqual({ firms: 700 });
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM firm WHERE "successionRisk" IS NOT NULL`,
    );
    expect(n).toBe(0);
  }, 300_000);

  it("restores a snapshot taken before a table existed, leaving it empty", async () => {
    const takenAt = new Date("2026-09-22T12:00:00.000Z");
    const db = await createTestDb();
    await resetDemo(db, takenAt, { newId: sequentialIds() });
    await saveSnapshot(db, takenAt);
    await db.exec(`DROP TABLE snapshot_extraction`);
    await db.query(`INSERT INTO extraction ("extractionId", "firmId") VALUES ('x', 'y')`);
    await expect(resetFromSnapshot(db, takenAt)).resolves.toEqual({ firms: 700 });
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM extraction`);
    expect(n).toBe(0);
  }, 300_000);

  it("refuses to reset without a snapshot", async () => {
    const db = await createTestDb();
    await expect(resetFromSnapshot(db)).rejects.toMatchObject({ status: 503 });
  });
});
