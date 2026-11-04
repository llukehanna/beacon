import { OBJECT_TYPES, type PropType } from "../../shared/schema.js";

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
 * CREATE TABLE IF NOT EXISTS never changes an existing table, so every non-key property is also
 * added with ADD COLUMN IF NOT EXISTS: a column introduced after a database was first created
 * reaches it the next time this runs.
 */
export function ddl(): string {
  const tables = Object.values(OBJECT_TYPES).flatMap((t) => {
    const cols = Object.entries(t.properties).map(
      ([name, type]) =>
        `  "${name}" ${SQL_TYPE[type]}${name === t.primaryKey ? " PRIMARY KEY" : ""}`,
    );
    const evolve = Object.entries(t.properties)
      .filter(([name]) => name !== t.primaryKey)
      .map(
        ([name, type]) =>
          `ALTER TABLE ${t.table} ADD COLUMN IF NOT EXISTS "${name}" ${SQL_TYPE[type]};`,
      );
    return [`CREATE TABLE IF NOT EXISTS ${t.table} (\n${cols.join(",\n")}\n);`, ...evolve];
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
