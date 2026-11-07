/**
 * The demo reset as a copy instead of a rebuild. Building the world through
 * the real actions takes about a second of CPU (thousands of queries), far
 * over a Cloudflare Worker's free-plan budget, so `npm run seed` builds it
 * once and saves every table under snapshot_*. The reset then restores those
 * tables in one transaction, shifting every timestamp by the time elapsed
 * since the snapshot, which gives the same rows a full rebuild would produce
 * at that moment.
 */
import { OBJECT_TYPES, OPERATIONS_TYPES, type PropType } from "../../shared/schema.js";
import type { Db, Queryable } from "../db/client.js";
import { getMeta, setMeta } from "../db/meta.js";
import { HttpError } from "../errors.js";

const SNAPSHOT_AT = "snapshotAt";

const OPERATIONS_TABLES: readonly string[] = OPERATIONS_TYPES.map((n) => OBJECT_TYPES[n].table);

/** Every table the full reset rebuilds, with its columns. Operations metrics are measurements, not demo data: they are not here. */
const TABLES: Readonly<Record<string, Readonly<Record<string, PropType>>>> = {
  ...Object.fromEntries(
    Object.values(OBJECT_TYPES)
      .filter((t) => !OPERATIONS_TABLES.includes(t.table))
      .map((t) => [t.table, t.properties]),
  ),
  search_list_firm: { searchId: "string", firmId: "string" },
};

const snapshotOf = (table: string): string => `snapshot_${table}`;

/** Columns each snapshot table actually has: one saved before a property was added lacks it. */
async function snapshotColumns(tx: Queryable): Promise<Map<string, Set<string>>> {
  const rows = await tx.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns ` +
      `WHERE table_schema = current_schema() AND table_name LIKE 'snapshot\\_%'`,
  );
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    out.set(r.table_name, (out.get(r.table_name) ?? new Set()).add(r.column_name));
  }
  return out;
}

/** The latest value over every timestamp column of the live demo tables, in epoch milliseconds; null when there is none. */
export async function latestTimestampMs(q: Queryable): Promise<number | null> {
  let latest: number | null = null;
  for (const [table, columns] of Object.entries(TABLES)) {
    const stamps = Object.entries(columns)
      .filter(([, type]) => type === "timestamp")
      .map(([name]) => `"${name}"`);
    if (stamps.length === 0) {
      continue;
    }
    // greatest() skips NULLs, so a row with only some of its timestamps set still counts.
    const [{ ms }] = await q.query<{ ms: number | null }>(
      `SELECT floor(extract(epoch FROM max(greatest(${stamps.join(", ")}))) * 1000)::float8 AS ms FROM ${table}`,
    );
    if (ms !== null && (latest === null || ms > latest)) {
      latest = ms;
    }
  }
  return latest;
}

/**
 * Move every timestamp in the live demo tables by `shiftMs` milliseconds. Runs in the caller's
 * transaction, which must be in UTC.
 */
export async function shiftLiveTimestamps(q: Queryable, shiftMs: number): Promise<void> {
  const shift = `interval '${Math.round(shiftMs)} milliseconds'`;
  for (const [table, columns] of Object.entries(TABLES)) {
    const sets = Object.entries(columns).flatMap(([name, type]) =>
      type === "timestamp" ? [`"${name}" = "${name}" + ${shift}`] : [],
    );
    if (sets.length > 0) {
      await q.query(`UPDATE ${table} SET ${sets.join(", ")}`);
    }
  }
}

function restoreSql(table: string, shift: string, have: ReadonlySet<string>): string {
  const cols = Object.entries(TABLES[table]);
  const values = cols.map(([name, type]) => {
    // A property added after the snapshot was taken restores as NULL until the next `npm run seed`.
    if (!have.has(name)) {
      return "NULL";
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
    // The metrics tables are cleared but not restored: the operations window starts at each reset.
    await tx.query(`TRUNCATE ${[...Object.keys(TABLES), ...OPERATIONS_TABLES].join(", ")}`);
    const columns = await snapshotColumns(tx);
    for (const table of Object.keys(TABLES)) {
      const have = columns.get(snapshotOf(table));
      // A table added after the snapshot was taken has no snapshot table: it stays empty.
      if (have) {
        await tx.query(restoreSql(table, shift, have));
      }
    }
    const [{ n }] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM firm`);
    return n;
  });
  await setMeta(db, "lastResetAt", now.toISOString());
  return { firms };
}
