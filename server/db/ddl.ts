import { OBJECT_TYPES, type ObjectTypeDef, type PropType } from "../../shared/schema.js";

export const SQL_TYPE: Readonly<Record<PropType, string>> = {
  string: "text",
  integer: "integer",
  double: "double precision",
  boolean: "boolean",
  timestamp: "timestamptz",
  "string[]": "text[]",
};

/**
 * The schema `shared/schema.ts` describes, as SQL: one table per object type (camelCase columns,
 * quoted, NOT NULL where the type lists the column as required), plus join and meta tables. It has
 * no foreign keys, unique constraints or triggers: those are in migration 0003. Nothing runs it. The database is changed only by the numbered
 * migrations in `server/db/migrations/`; a test applies this output to an empty database and checks
 * that the migrated schema has the same tables, columns and types, so a property added to the schema
 * without a migration fails there.
 */
export function ddl(): string {
  const tables = Object.values(OBJECT_TYPES).map((t) => {
    const required = new Set<string>((t as ObjectTypeDef).required ?? []);
    const cols = Object.entries(t.properties).map(
      ([name, type]) =>
        `  "${name}" ${SQL_TYPE[type]}${name === t.primaryKey ? " PRIMARY KEY" : required.has(name) ? " NOT NULL" : ""}`,
    );
    return `CREATE TABLE IF NOT EXISTS ${t.table} (\n${cols.join(",\n")}\n);`;
  });
  return [
    ...tables,
    `CREATE TABLE IF NOT EXISTS search_list_firm ("searchId" text NOT NULL, "firmId" text NOT NULL, PRIMARY KEY ("searchId", "firmId"));`,
    `CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text, "updatedAt" timestamptz NOT NULL DEFAULT now());`,
    `CREATE INDEX IF NOT EXISTS research_finding_firm ON research_finding ("firmId");`,
    `CREATE INDEX IF NOT EXISTS extraction_firm ON extraction ("firmId");`,
    `CREATE INDEX IF NOT EXISTS review_decision_firm ON review_decision ("firmId");`,
    `CREATE INDEX IF NOT EXISTS qualification_score_firm ON qualification_score ("firmId");`,
    `CREATE INDEX IF NOT EXISTS drift_event_firm ON drift_event ("firmId");`,
    `CREATE INDEX IF NOT EXISTS search_membership_search ON search_membership ("searchId");`,
    `CREATE INDEX IF NOT EXISTS market_signal_firm ON market_signal ("firmId");`,
    // The hourly run asks only for what is unapplied and due; the partial index keeps that one cheap lookup.
    `CREATE INDEX IF NOT EXISTS market_signal_due ON market_signal ("effectiveDate") WHERE "appliedAt" IS NULL;`,
  ].join("\n");
}
