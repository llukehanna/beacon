/**
 * The advisory-acquisitions workspace as a rubric context, for tests. Test firms are often
 * written with today's firm columns (`servicesFit`, `employees`); `withTraits` gives them the
 * `traits` map the API attaches, so the models read them the way they read a loaded firm.
 */
import { ADVISORY_ACQUISITIONS } from "../../workspaces/advisoryAcquisitions.js";
import type { RubricContext, TraitValue } from "../types.js";
import { legacyTraits } from "../workspace.js";

export const ADVISORY: RubricContext = {
  definition: ADVISORY_ACQUISITIONS.rubric,
  traits: ADVISORY_ACQUISITIONS.traits,
};

/** The firm with its column values as traits (an explicit `traits` entry wins). */
export function withTraits<T extends object>(firm: T): T & { traits: Record<string, TraitValue> } {
  const own = (firm as { traits?: Record<string, TraitValue> | null }).traits ?? {};
  return {
    ...firm,
    traits: { ...legacyTraits(ADVISORY_ACQUISITIONS, firm as Record<string, unknown>), ...own },
  };
}
