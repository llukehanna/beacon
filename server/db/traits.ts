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
