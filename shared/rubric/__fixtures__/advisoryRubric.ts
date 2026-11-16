/**
 * The advisory-acquisitions workspace as a rubric context, for tests. Test firms are often
 * written with the firm columns traits had before migration 0006 (`servicesFit`, `employees`);
 * `withTraits` gives them the `traits` map the API attaches, so the models read them the way they
 * read a loaded firm.
 */
import { ADVISORY_ACQUISITIONS } from "../../workspaces/advisoryAcquisitions.js";
import type { RubricContext, TraitValue } from "../types.js";

export const ADVISORY: RubricContext = {
  definition: ADVISORY_ACQUISITIONS.rubric,
  traits: ADVISORY_ACQUISITIONS.traits,
};

/** A row's non-empty values under the old column names, keyed by trait. */
export function columnTraits(row: Readonly<Record<string, unknown>>): Record<string, TraitValue> {
  const out: Record<string, TraitValue> = {};
  for (const [field, key] of Object.entries(ADVISORY_ACQUISITIONS.legacyFieldAliases)) {
    const v = row[field];
    if (
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    ) {
      out[key] = v;
    }
  }
  return out;
}

/** The firm with its column values as traits (an explicit `traits` entry wins). */
export function withTraits<T extends object>(firm: T): T & { traits: Record<string, TraitValue> } {
  const own = (firm as { traits?: Record<string, TraitValue> | null }).traits ?? {};
  return {
    ...firm,
    traits: { ...columnTraits(firm as Record<string, unknown>), ...own },
  };
}
