import { OBJECT_TYPES, type ObjectOf, type ObjectTypeName } from "../../shared/schema.js";

const less = (a: unknown, b: unknown): number => {
  if (a === b) {
    return 0;
  }
  // A missing value sorts last.
  if (a === undefined || a === null) {
    return 1;
  }
  if (b === undefined || b === null) {
    return -1;
  }
  return (a as string | number) < (b as string | number) ? -1 : 1;
};

/**
 * Rows ordered by the given properties, then by primary key, comparing text by UTF-16 code unit.
 * Postgres sorts text by the server's collation (C in PGlite, possibly a locale on a hosted
 * database that ignores punctuation), so a seed that picks "the first N" by a text column would
 * pick different rows on different servers. Sorting here makes the choice the same everywhere.
 */
export function sortedRows<N extends ObjectTypeName>(
  type: N,
  rows: readonly ObjectOf<N>[],
  keys: readonly string[] = [],
): ObjectOf<N>[] {
  const cols = [...keys, OBJECT_TYPES[type].primaryKey];
  return [...rows].sort((a, b) => {
    for (const c of cols) {
      const d = less((a as Record<string, unknown>)[c], (b as Record<string, unknown>)[c]);
      if (d !== 0) {
        return d;
      }
    }
    return 0;
  });
}
