/**
 * The one place that names a rubric axis for a person. The desk, the tear sheet, the Home feed,
 * the evals, the exports and the MCP evidence all read their axis labels from here, in sentence
 * case, so the same axis never goes by two names.
 *
 * Axes arrive in several spellings: the finding vocabulary (`deal_size_usd_m`), the firm property
 * (`dealSizeMUsd`), the rubric mirror's own names (`Deal Size`, `MD Experience`) and a few older
 * short forms. Every spelling is folded onto one key (lower case, letters and digits only).
 * Pure: no React, no data access.
 */

/** Canonical label per folded key. Several spellings of one axis share a label on purpose. */
const LABELS: Readonly<Record<string, string>> = {
  coveragemodel: "Sector coverage",
  servicesfit: "Services fit",
  services: "Services fit",
  csservicesfit: "Services fit",
  mdpedigree: "MD pedigree",
  mdexperience: "MD pedigree",
  balancesheetprincipal: "Balance sheet / principal",
  dealsize: "Avg deal size",
  dealsizemusd: "Avg deal size",
  dealsizeusdm: "Avg deal size",
  dealspermd: "Deals per MD (last 3 years)",
  dealspermdl3y: "Deals per MD (last 3 years)",
  firmage: "Firm age",
  firmageyears: "Firm age",
  employees: "Headcount",
  headcount: "Headcount",
  feegeneratingcount: "Fee-earning heads",
  feegenerating: "Fee-earning heads",
  geographicfootprint: "Geographic fit",
  geoscore: "Geographic fit",
  // The four yes/no gates. The two spellings of the balance-sheet gate mirror FINDING_AXIS_TO_KEY.
  advisoryconflict: "Advisory conflict",
  hasstorbalancesheet: "Sales & trading / balance sheet",
  storbalancesheet: "Sales & trading / balance sheet",
  webactivity: "Web activity",
  solvent: "Solvent",
};

/** What an axis the map does not know reads as. */
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

/** The label for an axis in any of its spellings; an unknown axis is put into sentence case. */
export function axisLabel(raw: string | undefined | null): string {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return UNKNOWN_AXIS;
  }
  return LABELS[fold(raw)] ?? sentenceCase(raw);
}

/** True when the map names the axis, whatever its spelling. */
export function isKnownAxis(raw: string | undefined | null): boolean {
  return raw !== undefined && raw !== null && LABELS[fold(raw)] !== undefined;
}
