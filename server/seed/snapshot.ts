/**
 * The demo reset as a copy instead of a rebuild. Building the world through
 * the real actions takes about a second of CPU (thousands of queries), far
 * over a Cloudflare Worker's free-plan budget, so `npm run seed` builds it
 * once and saves every table under snapshot_*. The reset then restores those
 * tables in one transaction, shifting every timestamp by the time elapsed
 * since the snapshot, which gives the same rows a full rebuild would produce
 * at that moment.
 */
import { OBJECT_TYPES, type PropType } from "../../shared/schema.js";
import type { Db } from "../db/client.js";
import { getMeta, setMeta } from "../db/meta.js";
import { HttpError } from "../errors.js";

const SNAPSHOT_AT = "snapshotAt";

/** Every table the full reset rebuilds, with its columns. */
const TABLES: Readonly<Record<string, Readonly<Record<string, PropType>>>> = {
  ...Object.fromEntries(Object.values(OBJECT_TYPES).map((t) => [t.table, t.properties])),
  search_list_firm: { searchId: "string", firmId: "string" },
};

const snapshotOf = (table: string): string => `snapshot_${table}`;

/** JavaScript's Date#toISOString in SQL; the reset transaction runs in UTC. */
const isoSql = (expr: string): string => `to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Text values that embed a timestamp, so the shift rewrites them too: a
 * search's name ends with its run date, and a drift event's changed axes
 * carry its detection time.
 */
const TEXT_SHIFTS: Readonly<Record<string, Readonly<Record<string, (shift: string) => string>>>> = {
  search: {
    name: (shift) =>
      `CASE WHEN name ~ ' · \\d{4}-\\d{2}-\\d{2}$' AND "runAt" IS NOT NULL ` +
      `THEN left(name, -10) || to_char("runAt" + ${shift}, 'YYYY-MM-DD') ELSE name END`,
  },
  drift_event: {
    changedAxes: (shift) =>
      `CASE WHEN "detectedAt" IS NULL THEN "changedAxes" ELSE replace("changedAxes", ` +
      `'"dated":"' || ${isoSql(`"detectedAt"`)} || '"', ` +
      `'"dated":"' || ${isoSql(`"detectedAt" + ${shift}`)} || '"') END`,
  },
};

function restoreSql(table: string, shift: string): string {
  const cols = Object.entries(TABLES[table]);
  const values = cols.map(([name, type]) => {
    const text = TEXT_SHIFTS[table]?.[name];
    if (text) {
      return text(shift);
    }
    return type === "timestamp" ? `"${name}" + ${shift}` : `"${name}"`;
  });
  return (
    `INSERT INTO ${table} (${cols.map(([name]) => `"${name}"`).join(", ")}) ` +
    `SELECT ${values.join(", ")} FROM ${snapshotOf(table)}`
  );
}

/** Save the current tables as the snapshot the reset restores. `takenAt` is the `now` they were built at. */
export async function saveSnapshot(db: Db, takenAt: Date): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of Object.keys(TABLES)) {
      await tx.query(`DROP TABLE IF EXISTS ${snapshotOf(table)}`);
      await tx.query(`CREATE TABLE ${snapshotOf(table)} AS TABLE ${table}`);
    }
    await setMeta(tx, SNAPSHOT_AT, takenAt.toISOString());
  });
}

/** Replace every demo table with the snapshot, moved forward to `now`, in one transaction. */
export async function resetFromSnapshot(
  db: Db,
  now: Date = new Date(),
): Promise<{ firms: number }> {
  const takenAt = await getMeta(db, SNAPSHOT_AT);
  if (takenAt === null) {
    throw new HttpError(
      "The demo snapshot is missing. Run `npm run seed` against this database.",
      503,
    );
  }
  // A whole number of milliseconds: an interval with no day part, so the shift is exact in any time zone.
  const shift = `interval '${Math.round(now.getTime() - Date.parse(takenAt))} milliseconds'`;
  const firms = await db.transaction(async (tx) => {
    await tx.query(`SET LOCAL TIME ZONE 'UTC'`);
    await tx.query(`TRUNCATE ${Object.keys(TABLES).join(", ")}`);
    for (const table of Object.keys(TABLES)) {
      await tx.query(restoreSql(table, shift));
    }
    const [{ n }] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM firm`);
    return n;
  });
  await setMeta(db, "lastResetAt", now.toISOString());
  return { firms };
}
