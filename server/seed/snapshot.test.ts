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
    // A search's name ends with its run date; after the shift the date still follows runAt.
    const searches = (b.search as { name: string; runAt: Date | string | null }[]).filter(
      (s) => s.runAt !== null && / · \d{4}-\d{2}-\d{2}$/.test(s.name),
    );
    expect(searches.length, "searches with a dated name").toBeGreaterThan(0);
    for (const s of searches) {
      expect(s.name.slice(-10), s.name).toBe(new Date(s.runAt!).toISOString().slice(0, 10));
    }
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

  it("restores a snapshot taken before ProposedRule.proposedAt existed, leaving it empty", async () => {
    const takenAt = new Date("2026-09-22T12:00:00.000Z");
    const db = await createTestDb();
    await resetDemo(db, takenAt, { newId: sequentialIds() });
    const [{ n: proposed }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM proposed_rule WHERE "proposedAt" IS NOT NULL`,
    );
    expect(proposed, "the seed proposes rules with a time").toBeGreaterThan(0);
    await saveSnapshot(db, takenAt);
    await db.exec(`ALTER TABLE snapshot_proposed_rule DROP COLUMN "proposedAt"`);
    await expect(resetFromSnapshot(db, takenAt)).resolves.toEqual({ firms: 700 });
    const [{ rules, stamped }] = await db.query<{ rules: number; stamped: number }>(
      `SELECT count(*)::int AS rules, count("proposedAt")::int AS stamped FROM proposed_rule`,
    );
    expect(rules).toBeGreaterThan(0);
    expect(stamped).toBe(0);
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

/** The latest value over every timestamp column of every demo table, with where it came from. */
async function latestTimestamp(db: Db): Promise<{ at: Date; where: string }> {
  let latest = { at: new Date(0), where: "" };
  for (const t of Object.values(OBJECT_TYPES)) {
    for (const [column, type] of Object.entries(t.properties)) {
      // A market signal's effectiveDate is when it is scheduled to take effect: the seed stores the
      // few due in the next day, so it is not history and may lie after the seed.
      if (type !== "timestamp" || `${t.table}.${column}` === "market_signal.effectiveDate") {
        continue;
      }
      const [{ at }] = await db.query<{ at: Date | string | null }>(
        `SELECT max("${column}") AS at FROM ${t.table}`,
      );
      if (at !== null && new Date(at) > latest.at) {
        latest = { at: new Date(at), where: `${t.table}.${column}` };
      }
    }
  }
  return latest;
}

describe("seeded history ends at seed time", () => {
  const MINUTE = 60_000;
  const seedNow = new Date("2026-09-22T12:00:00.000Z");
  const resetNow = new Date("2026-10-05T23:59:30.123Z");

  it("puts the latest activity within the hour before the seed, and nothing after it", async () => {
    const db = await createTestDb();
    await resetDemo(db, seedNow, { newId: sequentialIds(), fixtures: [oneFixture(seedNow)] });

    const [{ at: enrichedAt }] = await db.query<{ at: Date | string }>(
      `SELECT max("enrichedAt") AS at FROM firm`,
    );
    const lag = seedNow.getTime() - new Date(enrichedAt).getTime();
    expect(lag, "latest enrichment is not after the seed").toBeGreaterThanOrEqual(0);
    expect(lag, "latest enrichment is within an hour of the seed").toBeLessThanOrEqual(60 * MINUTE);
    const latest = await latestTimestamp(db);
    expect(latest.at.getTime(), `latest timestamp (${latest.where})`).toBeLessThanOrEqual(
      seedNow.getTime(),
    );

    // The snapshot is the same world; a reset later moves all of it, still ending at the reset.
    await saveSnapshot(db, seedNow);
    await resetFromSnapshot(db, resetNow);
    const [{ at: afterReset }] = await db.query<{ at: Date | string }>(
      `SELECT max("enrichedAt") AS at FROM firm`,
    );
    const resetLag = resetNow.getTime() - new Date(afterReset).getTime();
    expect(resetLag).toBeGreaterThanOrEqual(0);
    expect(resetLag).toBeLessThanOrEqual(60 * MINUTE);
    const latestAfter = await latestTimestamp(db);
    expect(latestAfter.at.getTime(), `latest timestamp (${latestAfter.where})`).toBeLessThanOrEqual(
      resetNow.getTime(),
    );
  }, 300_000);
});
