/**
 * Which object types an action wrote to, read off the SQL it ran, so the
 * client can refresh just those. It fails closed: a statement that looks like
 * a write but can't be tied to a known table makes the answer "unknown"
 * (reported as no types, which clients treat as "refresh everything").
 */
import { LINKS, OBJECT_TYPES, OPERATIONS_TYPES, type ObjectTypeName } from "../../shared/schema.js";
import type { Queryable } from "../db/client.js";

/** Which object types a write to each table changes: its own, and the source of any link it joins. */
const TYPES_BY_TABLE = new Map<string, ObjectTypeName[]>();
for (const [name, def] of Object.entries(OBJECT_TYPES)) {
  // Operations metrics are written outside the action's transaction, so no action reports them.
  if ((OPERATIONS_TYPES as readonly string[]).includes(name)) {
    continue;
  }
  TYPES_BY_TABLE.set(def.table, [name as ObjectTypeName]);
}
for (const link of LINKS) {
  TYPES_BY_TABLE.set(link.joinTable, [
    ...new Set([...(TYPES_BY_TABLE.get(link.joinTable) ?? []), link.source]),
  ]);
}

/** Tables that hold no object data, so writing them changes nothing a client displays. */
const NON_OBJECT_TABLES = new Set(["meta"]);

/** Every table an action's writes can be attributed to (for tests). */
export const WRITABLE_TABLES: readonly string[] = [...TYPES_BY_TABLE.keys()];

export function typesForTable(table: string): readonly ObjectTypeName[] {
  return TYPES_BY_TABLE.get(table) ?? [];
}

const START = /^\s*(WITH|INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i;
const TARGET =
  /^\s*(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM(?:\s+ONLY)?)\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?(?=[\s(;]|$)/i;
const DML = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i;

/** The types one statement writes: [] for a read or an ignorable write, null when it writes something unrecognised. */
export function statementWrites(sql: string): readonly ObjectTypeName[] | null {
  const start = START.exec(sql)?.[1]?.toUpperCase();
  if (start === undefined) {
    return [];
  }
  if (start === "WITH") {
    // A CTE is a read unless it contains DML (FOR UPDATE is a lock, not a write).
    return DML.test(sql.replace(/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/gi, "")) ? null : [];
  }
  const table = TARGET.exec(sql)?.[1]?.toLowerCase();
  if (table === undefined) {
    return null;
  }
  if (TYPES_BY_TABLE.has(table)) {
    return TYPES_BY_TABLE.get(table)!;
  }
  return NON_OBJECT_TABLES.has(table) ? [] : null;
}

export interface WriteLog {
  /** Wraps a transaction so its statements are recorded. */
  track(tx: Queryable): Queryable;
  /** Sorted types written, or [] when any write could not be attributed. */
  types(): ObjectTypeName[];
}

export function writeLog(): WriteLog {
  const written = new Set<ObjectTypeName>();
  let unknown = false;
  return {
    track: (tx) => ({
      query(sql, params) {
        const types = statementWrites(sql);
        if (types === null) {
          unknown = true;
        } else {
          types.forEach((t) => written.add(t));
        }
        return tx.query(sql, params);
      },
    }),
    types: () => (unknown ? [] : [...written].sort()),
  };
}
