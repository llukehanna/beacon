/**
 * The one place that names a rubric axis for a person. The desk, the tear sheet, the Home feed,
 * the evals, the exports and the MCP evidence all read their axis labels from here, so the same
 * axis never goes by two names.
 *
 * Labels come from the trait catalog. An axis arrives either as a trait key (`deal_size_usd_m`,
 * the finding and rule vocabulary) or as a score's axis, which is the label of the criterion that
 * scored it (`Deal Size`); both fold onto the trait's label. Pure: no React, no data access.
 */
import type { RubricContext, TraitDef } from "./rubric/types.js";

/** What an axis the catalog does not know reads as. */
export const UNKNOWN_AXIS = "unknown axis";

/** "has_st_or_balance_sheet" as "Has st or balance sheet": sentence case, never Title Case. */
function sentenceCase(raw: string): string {
  const words = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
  return words.length === 0
    ? UNKNOWN_AXIS
    : `${words[0][0].toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(" ")}`.trim();
}

const fold = (raw: string): string => raw.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The catalog trait an axis names, by trait key, trait label, or the label of a criterion scoring it. */
export function traitOfAnyAxis(rubric: RubricContext, raw: string): TraitDef | undefined {
  const k = fold(raw);
  const direct = rubric.traits.find((t) => fold(t.traitKey) === k || fold(t.label) === k);
  if (direct !== undefined) {
    return direct;
  }
  for (const thesis of rubric.definition.theses) {
    const c = thesis.criteria.find((x) => fold(x.label) === k);
    if (c !== undefined) {
      return rubric.traits.find((t) => t.traitKey === c.traitKey);
    }
  }
  return undefined;
}

/** The label for an axis in any of its spellings; an unknown axis is put into sentence case. */
export function axisLabel(rubric: RubricContext, raw: string | undefined | null): string {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return UNKNOWN_AXIS;
  }
  return traitOfAnyAxis(rubric, raw)?.label ?? sentenceCase(raw);
}

/** True when the catalog names the axis, whatever its spelling. */
export function isKnownAxis(rubric: RubricContext, raw: string | undefined | null): boolean {
  return raw !== undefined && raw !== null && traitOfAnyAxis(rubric, raw) !== undefined;
}
