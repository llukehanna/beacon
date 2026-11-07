/**
 * The demo reset as a copy instead of a rebuild. Building the world through
 * the real actions takes about a second of CPU (thousands of queries), far
 * over a Cloudflare Worker's free-plan budget, so `npm run seed` builds it
 * once and saves every table under snapshot_*. The reset then restores those
 * tables in one transaction, shifting every timestamp by the time elapsed
 * since the snapshot, which gives the same rows a full rebuild would produce
 * at that moment.
 */
import {
  OBJECT_TYPES,
  OPERATIONS_TYPES,
  type ObjectTypeDef,
  type PropType,
} from "../../shared/schema.js";
import type { Db, Queryable } from "../db/client.js";
import { APPEND_ONLY_TABLES } from "../db/history.js";
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

/** The columns each demo table's rows may not leave empty (NOT NULL since migration 0003). */
const REQUIRED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.values<ObjectTypeDef>(OBJECT_TYPES)
    .filter((t) => t.table in TABLES)
    .map((t) => [t.table, t.required ?? []]),
);

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

const APPEND_ONLY: readonly string[] = APPEND_ONLY_TABLES;

/**
 * Move every timestamp in the live demo tables by `shiftMs` milliseconds. Runs in the caller's
 * transaction, which must be in UTC.
 *
 * An append-only table refuses UPDATE (migration 0003), so its rows are moved by rewriting the
 * table: the shifted rows go to a temporary table, the table is truncated (which fires no row
 * trigger) and they are copied back. Postgres will not truncate a table that has deferred
 * foreign-key checks pending, so those run first (`SET CONSTRAINTS ALL IMMEDIATE`) and the
 * deferral is restored afterwards.
 */
export async function shiftLiveTimestamps(q: Queryable, shiftMs: number): Promise<void> {
  const shift = `interval '${Math.round(shiftMs)} milliseconds'`;
  const rewritten: string[] = [];
  for (const [table, columns] of Object.entries(TABLES)) {
    const stamps = Object.entries(columns).filter(([, type]) => type === "timestamp");
    if (stamps.length === 0) {
      continue;
    }
    if (APPEND_ONLY.includes(table)) {
      rewritten.push(table);
      continue;
    }
    await q.query(
      `UPDATE ${table} SET ${stamps.map(([name]) => `"${name}" = "${name}" + ${shift}`).join(", ")}`,
    );
  }
  if (rewritten.length === 0) {
    return;
  }
  await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
  for (const table of rewritten) {
    const cols = Object.keys(TABLES[table]).map((name) => `"${name}"`);
    const shifted = Object.entries(TABLES[table]).map(([name, type]) =>
      type === "timestamp" ? `"${name}" + ${shift}` : `"${name}"`,
    );
    const copy = `shifted_${table}`;
    await q.query(
      `CREATE TEMP TABLE ${copy} ON COMMIT DROP AS SELECT ${shifted.map((v, i) => `${v} AS ${cols[i]}`).join(", ")} FROM ${table}`,
    );
    await q.query(`TRUNCATE ${table}`);
    await q.query(
      `INSERT INTO ${table} (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM ${copy}`,
    );
    await q.query(`DROP TABLE ${copy}`);
  }
  await q.query(`SET CONSTRAINTS ALL DEFERRED`);
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
    const columns = await snapshotColumns(tx);
    // A column that became required after the snapshot was saved cannot be restored as NULL. Say so
    // up front, before the tables are cleared, instead of failing partway on the constraint.
    for (const [table, required] of Object.entries(REQUIRED)) {
      const have = columns.get(snapshotOf(table));
      const missing = have ? required.filter((c) => !have.has(c)) : [];
      if (missing.length > 0) {
        throw new HttpError(
          `The demo snapshot predates ${table}.${missing[0]}, which is now required. Run \`npm run seed\` against this database.`,
          503,
        );
      }
    }
    // The metrics tables are cleared but not restored: the operations window starts at each reset.
    // One statement, naming every demo table: Postgres refuses to truncate a table a foreign key
    // points at unless the tables that point at it are truncated with it.
    await tx.query(`TRUNCATE ${[...Object.keys(TABLES), ...OPERATIONS_TABLES].join(", ")}`);
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
