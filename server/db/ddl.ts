import { OBJECT_TYPES, type PropType } from "../../shared/schema.js";
import type { Db } from "./client.js";

const SQL_TYPE: Readonly<Record<PropType, string>> = {
  string: "text",
  integer: "integer",
  double: "double precision",
  boolean: "boolean",
  timestamp: "timestamptz",
  "string[]": "text[]",
};

export const OBJECT_TABLES: readonly string[] = Object.values(OBJECT_TYPES).map((t) => t.table);

/**
 * Idempotent schema: one table per object type (camelCase columns, quoted), plus join and meta tables.
 * It only creates what is missing and takes no lock on existing tables, so it is safe to run on every
 * cold start. Columns added to a property list after a table exists are handled by `ensureSchema`.
 */
export function ddl(): string {
  const tables = Object.values(OBJECT_TYPES).map((t) => {
    const cols = Object.entries(t.properties).map(
      ([name, type]) =>
        `  "${name}" ${SQL_TYPE[type]}${name === t.primaryKey ? " PRIMARY KEY" : ""}`,
    );
    return `CREATE TABLE IF NOT EXISTS ${t.table} (\n${cols.join(",\n")}\n);`;
  });
  return [
    ...tables,
    `CREATE TABLE IF NOT EXISTS search_list_firm ("searchId" text NOT NULL, "firmId" text NOT NULL, PRIMARY KEY ("searchId", "firmId"));`,
    `CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text, "updatedAt" timestamptz NOT NULL DEFAULT now());`,
    `CREATE INDEX IF NOT EXISTS research_finding_firm ON research_finding ("firmId");`,
    `CREATE INDEX IF NOT EXISTS review_decision_firm ON review_decision ("firmId");`,
    `CREATE INDEX IF NOT EXISTS qualification_score_firm ON qualification_score ("firmId");`,
    `CREATE INDEX IF NOT EXISTS drift_event_firm ON drift_event ("firmId");`,
    `CREATE INDEX IF NOT EXISTS search_membership_search ON search_membership ("searchId");`,
  ].join("\n");
}

/** The `ALTER TABLE ... ADD COLUMN` statements for schema properties an existing table lacks. */
export function missingColumnStatements(
  existing: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  return Object.values(OBJECT_TYPES).flatMap((t) => {
    const have = existing.get(t.table);
    if (!have) {
      return [];
    }
    return Object.entries(t.properties)
      .filter(([name]) => !have.has(name))
      .map(([name, type]) => `ALTER TABLE ${t.table} ADD COLUMN "${name}" ${SQL_TYPE[type]}`);
  });
}

/**
 * Create the schema, then add any property column a pre-existing table lacks (a column introduced
 * after the database was first created). The columns are read once; in steady state nothing is
 * missing, so no ALTER runs and no table is locked. ALTER takes an ACCESS EXCLUSIVE lock, so when
 * one is needed it runs in a transaction that gives up after 5 seconds instead of queueing traffic.
 */
export async function ensureSchema(db: Db): Promise<void> {
  await db.exec(ddl());
  const rows = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [OBJECT_TABLES],
  );
  const existing = new Map<string, Set<string>>();
  for (const r of rows) {
    existing.set(r.table_name, (existing.get(r.table_name) ?? new Set()).add(r.column_name));
  }
  const alters = missingColumnStatements(existing);
  if (alters.length === 0) {
    return;
  }
  await db.transaction(async (tx) => {
    await tx.query(`SET LOCAL lock_timeout = '5s'`);
    for (const sql of alters) {
      await tx.query(sql);
    }
  });
}
