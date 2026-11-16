/**
 * Where a firm's `traits` map comes from. Every reader of firm rows (the repo,
 * and the summaries that select firm columns with raw SQL) goes through here,
 * so moving trait storage changes this one module.
 *
 * Today firms still store traits as columns, so the map is derived from them.
 */
import type { TraitValue } from "../../shared/rubric/types.js";
import { legacyTraits } from "../../shared/rubric/workspace.js";
import { ADVISORY_ACQUISITIONS } from "../../shared/workspaces/advisoryAcquisitions.js";

export function withTraits<T extends Record<string, unknown>>(
  row: T,
): T & { traits: Record<string, TraitValue> } {
  return { ...row, traits: legacyTraits(ADVISORY_ACQUISITIONS, row) };
}

const COLUMN_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ADVISORY_ACQUISITIONS.legacyFields).map(([column, key]) => [key, column]),
);

/** The firm column a trait is stored in today, or undefined for an unknown trait. */
export function traitColumn(traitKey: string): string | undefined {
  return COLUMN_OF[traitKey];
}

/** Every historic field name (camelCase columns, action params) and trait key, as a trait key. */
export function traitKeyFor(name: string): string | undefined {
  return ADVISORY_ACQUISITIONS.legacyFieldAliases[name] ?? (COLUMN_OF[name] ? name : undefined);
}

/** The firm columns that store traits today: what a raw SELECT needs for `withTraits`. */
export function traitColumns(): string[] {
  return Object.keys(ADVISORY_ACQUISITIONS.legacyFields);
}
