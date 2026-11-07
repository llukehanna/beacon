import type { ActionParams } from "./actionParams.js";
import { type FindingLike, retrievedMs } from "./axisState.js";
import { HARD_GATE_EDIT_KEYS } from "./findingActions.js";
import { type Model, type ScoreInput } from "./scoreMirror.js";

export interface FirmView {
  firmId?: string;
  firmName?: string | null;
  firmType?: string | null;
  coverageModel?: string | null;
  servicesFit?: string | null;
  mdPedigree?: string | null;
  balanceSheetPrincipal?: string | null;
  geoScore?: number | null;
  dealSizeMUsd?: number | null;
  dealsPerMdL3y?: number | null;
  firmAge?: number | null;
  employees?: number | null;
  feeGeneratingCount?: number | null;
  geographicFootprint?: string | null;
  advisoryConflict?: boolean | null;
  // NB: SDK spells this hasSTOrBalanceSheet; enrichFirmAction param is hasStOrBalanceSheet.
  hasSTOrBalanceSheet?: boolean | null;
  webActivity?: boolean | null;
  solvent?: boolean | null;
  hqCountry?: string | null;
  lifecycleState?: string | null;
  currentStage?: string | null;
  sector?: string | null;
  employeeGroup?: string | null;
  revenueBand?: string | null;
  ownership?: string | null;
  successionRisk?: string | null;
  // When and by whom the firm was last enriched ("agent" until an analyst commits).
  enrichedAt?: string | null;
  enrichedBy?: string | null;
  // Read by the header/queue to detect a server-side hard screen driven by
  // an approved HardScreenConfig row (post backend fix). Any string
  // containing "reject" / "screen" / "hard" is treated as hard-screened.
  disposition?: string | null;
  // The market outcome backfilled on the firm, and when and from where it was seen.
  outcome?: string | null;
  outcomeObservedAt?: string | null;
  outcomeSource?: string | null;
}

export type EditMap = Record<string, string | number | boolean>;

export const NUMERIC_KEYS = ["dealSizeMUsd", "dealsPerMdL3y", "firmAge", "feeGeneratingCount"];

/** The enrichFirm call that commits a firm's staged edits; blank edits are left out. */
export function enrichParams(firmId: string, edits: EditMap): ActionParams<"enrichFirm"> {
  const params: Record<string, string | number | boolean> = {
    firm: firmId,
    fieldsEnteredManually: JSON.stringify(Object.keys(edits)),
  };
  for (const [k, v] of Object.entries(edits)) {
    if (v === "" || v === undefined) {
      continue;
    }
    params[k] = NUMERIC_KEYS.includes(k) ? Number(v) : v;
  }
  // The edit keys are the enrichFirm parameter names (editorForEditKey); the server rejects any other.
  return params as ActionParams<"enrichFirm">;
}

// Canonical axis→edit-key mapping lives in ./findingActions so the accept
// / verify / conflict-detection logic can be unit-tested without React.

// Human labels for the findings section header. Anything not in the map falls
// back to the raw axis key (still readable — the agent vocabulary is
// snake_case English).
const AXIS_DISPLAY_LABEL: Record<string, string> = {
  services_fit: "Services fit",
  md_pedigree: "MD pedigree",
  balance_sheet_principal: "Balance sheet / principal",
  deal_size: "Avg deal size",
  deal_size_usd_m: "Avg deal size",
  deals_per_md: "Deals / MD (L3Y)",
  deals_per_md_l3y: "Deals / MD (L3Y)",
  firm_age: "Firm age",
  firm_age_years: "Firm age",
  fee_generating_count: "Fee-earning heads",
  coverage_model: "Sector coverage",
  geographic_footprint: "Geographic fit",
  employees: "Employees",
  // Hard-gate axes render with the same labels as the hard-gate checklist so
  // the analyst reads one vocabulary. Two spellings for the balance-sheet
  // gate mirror FINDING_AXIS_TO_KEY's alias.
  advisory_conflict: "Advisory conflict",
  has_st_or_balance_sheet: "S&T / balance sheet",
  st_or_balance_sheet: "S&T / balance sheet",
  web_activity: "Web activity",
  solvent: "Solvent",
};

export function displayAxis(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    return "unknown axis";
  }
  return AXIS_DISPLAY_LABEL[raw.trim().toLowerCase()] ?? raw;
}

export function toScoreInput(f: FirmView): ScoreInput {
  return {
    firmType: f.firmType,
    coverageModel: f.coverageModel,
    servicesFit: f.servicesFit,
    mdPedigree: f.mdPedigree,
    balanceSheetPrincipal: f.balanceSheetPrincipal,
    geoScore: f.geoScore,
    dealSizeMUsd: f.dealSizeMUsd,
    dealsPerMdL3y: f.dealsPerMdL3y,
    firmAge: f.firmAge,
    employees: f.employees,
    feeGeneratingCount: f.feeGeneratingCount,
    geographicFootprint: f.geographicFootprint,
    advisoryConflict: f.advisoryConflict,
  };
}

export function buildMerged(base: ScoreInput, edits: EditMap): ScoreInput {
  const m: ScoreInput = { ...base };
  if (typeof edits.servicesFit === "string" && edits.servicesFit !== "") {
    m.servicesFit = edits.servicesFit;
  }
  if (typeof edits.mdPedigree === "string" && edits.mdPedigree !== "") {
    m.mdPedigree = edits.mdPedigree;
  }
  if (typeof edits.balanceSheetPrincipal === "string" && edits.balanceSheetPrincipal !== "") {
    m.balanceSheetPrincipal = edits.balanceSheetPrincipal;
  }
  if (edits.dealSizeMUsd !== undefined && edits.dealSizeMUsd !== "") {
    m.dealSizeMUsd = Number(edits.dealSizeMUsd);
  }
  if (edits.dealsPerMdL3y !== undefined && edits.dealsPerMdL3y !== "") {
    m.dealsPerMdL3y = Number(edits.dealsPerMdL3y);
  }
  if (edits.firmAge !== undefined && edits.firmAge !== "") {
    m.firmAge = Number(edits.firmAge);
  }
  if (edits.feeGeneratingCount !== undefined && edits.feeGeneratingCount !== "") {
    m.feeGeneratingCount = Number(edits.feeGeneratingCount);
  }
  if (typeof edits.advisoryConflict === "boolean") {
    m.advisoryConflict = edits.advisoryConflict;
  }
  return m;
}

interface CatOption {
  score: 0 | 1 | 2;
  label: string;
}

const CF_SERVICES_OPTS: CatOption[] = [
  { score: 0, label: "Conflicted: trading, lending or research" },
  { score: 1, label: "Adjacent advisory services" },
  { score: 2, label: "Full advisory suite" },
];

const CF_MD_OPTS: CatOption[] = [
  { score: 0, label: "Operator / non-finance backgrounds" },
  { score: 1, label: "Mixed: industry or boutique banking" },
  { score: 2, label: "Bulge-bracket or elite-boutique alumni" },
];

const CS_SERVICES_OPTS: CatOption[] = [
  { score: 0, label: "No private-capital products" },
  { score: 1, label: "Some private-capital products" },
  { score: 2, label: "Full private-capital suite" },
];

const CS_MD_OPTS: CatOption[] = [
  { score: 0, label: "Non-finance backgrounds" },
  { score: 1, label: "Some credit or banking experience" },
  { score: 2, label: "Senior credit / capital-markets pedigree" },
];

const CS_BSP_OPTS: CatOption[] = [
  { score: 0, label: "Invests its own balance sheet" },
  { score: 1, label: "Occasional co-investment" },
  { score: 2, label: "Advisory only" },
];

export interface AxisEditor {
  editKey: string;
  kind: "categorical" | "number";
  options?: CatOption[];
  unit?: string;
}

export function editorForAxis(axisLabel: string, model: Model): AxisEditor | undefined {
  switch (axisLabel) {
    case "Services":
      return { editKey: "servicesFit", kind: "categorical", options: CF_SERVICES_OPTS };
    case "CS Services Fit":
      return { editKey: "servicesFit", kind: "categorical", options: CS_SERVICES_OPTS };
    case "MD Experience":
      return {
        editKey: "mdPedigree",
        kind: "categorical",
        options: model === "CS" ? CS_MD_OPTS : CF_MD_OPTS,
      };
    case "Balance Sheet / Principal":
      return { editKey: "balanceSheetPrincipal", kind: "categorical", options: CS_BSP_OPTS };
    case "Deal Size":
      return { editKey: "dealSizeMUsd", kind: "number", unit: "$m USD" };
    case "Deals per MD":
      return { editKey: "dealsPerMdL3y", kind: "number", unit: "per MD, L3Y" };
    case "Firm Age":
      return { editKey: "firmAge", kind: "number", unit: "yrs" };
    case "Fee-Generating":
      return { editKey: "feeGeneratingCount", kind: "number", unit: "MDs" };
    default:
      return undefined;
  }
}

const EDITOR_LABELS: Record<Model, string[]> = {
  CF: ["Services", "MD Experience", "Deal Size", "Deals per MD", "Firm Age", "Fee-Generating"],
  CS: [
    "CS Services Fit",
    "MD Experience",
    "Balance Sheet / Principal",
    "Deal Size",
    "Deals per MD",
    "Firm Age",
    "Fee-Generating",
  ],
};

/** The editor for a firm field, by its edit key; undefined for gates and fields with no editor. */
export function editorForEditKey(editKey: string, model: Model): AxisEditor | undefined {
  for (const label of EDITOR_LABELS[model]) {
    const editor = editorForAxis(label, model);
    if (editor?.editKey === editKey) {
      return editor;
    }
  }
  return undefined;
}

/** The rubric mirror's axis label for a firm field (e.g. dealSizeMUsd is "Deal Size"); undefined for gates. */
export function mirrorLabelForEditKey(editKey: string, model: Model): string | undefined {
  return EDITOR_LABELS[model].find((label) => editorForAxis(label, model)?.editKey === editKey);
}

// ─── Search filter (rediscovery) ─────────────────────────────────────────
// When the desk is opened from Interpret & run search, ?search=<id> pins
// the queue to that search's firm set. Each firm carries a rediscovery
// signal — new firms have discoveredViaSearchId === this search; existing
// firms (dedupe hits) have absent / different discoveredViaSearchId and
// arrive with prior decision history the analyst should see up front.
type RediscoveryKind = "new" | "rediscovered";

export interface RediscoveryInfo {
  kind: RediscoveryKind;
  priorDecisions: number;
}

/**
 * How the desk labels a search: its name, then the day it ran ("Sell-side of Acme · 2026-09-01").
 * The date comes from runAt, not from the name, so it is the same moment every other screen shows;
 * a missing or unreadable runAt leaves the name alone. Empty when the search has neither.
 */
export function searchLabel(
  name: string | null | undefined,
  runAt: string | number | Date | null | undefined,
): string {
  const ms = runAt === null || runAt === undefined ? NaN : new Date(runAt).getTime();
  const day = Number.isNaN(ms) ? "" : new Date(ms).toISOString().slice(0, 10);
  return [(name ?? "").trim(), day].filter((part) => part !== "").join(" · ");
}

// Human-readable value per axis. Never surface rubric-band expressions
// ("geo_score=2", "8-40", ">$150m") — those are internal to mirrorScore.
export function humanAxisValue(axisLabel: string, firm: FirmView): string {
  switch (axisLabel) {
    case "Coverage Model":
      return firm.coverageModel ?? "—";
    case "Services":
    case "CS Services Fit":
      return firm.servicesFit ?? "—";
    case "MD Experience":
      return firm.mdPedigree ?? "—";
    case "Balance Sheet / Principal":
      return firm.balanceSheetPrincipal ?? "—";
    case "Geographic Footprint": {
      const parts: string[] = [];
      if (firm.hqCountry) {
        parts.push(firm.hqCountry);
      }
      if (firm.geographicFootprint && firm.geographicFootprint !== firm.hqCountry) {
        parts.push(firm.geographicFootprint);
      }
      return parts.length > 0 ? parts.join(" · ") : "—";
    }
    case "Deal Size":
      return firm.dealSizeMUsd !== null && firm.dealSizeMUsd !== undefined
        ? `$${firm.dealSizeMUsd}m`
        : "—";
    case "Deals per MD":
      return firm.dealsPerMdL3y !== null && firm.dealsPerMdL3y !== undefined
        ? `${firm.dealsPerMdL3y} deals/MD`
        : "—";
    case "Firm Age":
      return firm.firmAge !== null && firm.firmAge !== undefined ? `${firm.firmAge} yrs` : "—";
    case "Headcount":
      return firm.employees !== null && firm.employees !== undefined
        ? `${firm.employees} employees`
        : "—";
    case "Fee-Generating":
      return firm.feeGeneratingCount !== null && firm.feeGeneratingCount !== undefined
        ? `${firm.feeGeneratingCount} fee-earning heads`
        : "—";
    default:
      return "—";
  }
}

// Word-boundary truncation. Rewinds from a hard character cap back to the
// last space before appending "…" — avoids the mid-word cut ("geographic
// footpri") the character-count truncator produces on tokens without
// spaces near the limit. Falls back to hard cut when there's no space to
// rewind to (rare — a single very long token).
export function truncateAtWord(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const clipped = trimmed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  const cut = lastSpace > max * 0.5 ? clipped.slice(0, lastSpace) : clipped;
  return cut.trimEnd() + "…";
}

export function formatObservedDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  const d = new Date(t);
  // "Mar 2026" — matches the user's example.
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function describeCohort(firm: FirmView): string {
  const bits: string[] = [];
  if (firm.firmType) {
    bits.push(firm.firmType);
  }
  if (firm.employeeGroup) {
    bits.push(firm.employeeGroup);
  }
  const label = bits.join(" · ");
  return label === "" ? "similar" : `similar (${label})`;
}

export function formatRetrievedShort(f: FindingLike): string {
  const ms = retrievedMs(f);
  if (ms === 0) {
    return "";
  }
  const d = new Date(ms);
  // Compact local date — enough context for "which of these is newer".
  return d.toISOString().slice(0, 10);
}

// Format a coerced axis value as the string verifyFindingAction.overrideValue
// expects. Boolean gates read as "Yes" / "No"; everything else stringifies.
export function stringifyOverride(editKey: string, v: string | number | boolean): string {
  if (HARD_GATE_EDIT_KEYS.has(editKey)) {
    return v === true ? "Yes" : v === false ? "No" : String(v);
  }
  return String(v);
}

// Enum options for abstain axes that are picklists in the rubric. Two of
// them (servicesFit, mdPedigree) split by model — CF vs CS. Everything
// numeric / boolean / free-text is handled elsewhere via axisInputKind.
export function enumOptionsFor(editKey: string, model: Model): string[] {
  switch (editKey) {
    case "servicesFit":
      return (model === "CS" ? CS_SERVICES_OPTS : CF_SERVICES_OPTS).map((o) => o.label);
    case "mdPedigree":
      return (model === "CS" ? CS_MD_OPTS : CF_MD_OPTS).map((o) => o.label);
    case "balanceSheetPrincipal":
      return CS_BSP_OPTS.map((o) => o.label);
    case "coverageModel":
      return ["Single Coverage Focus", "Multi-Coverage Focus", "Generalist Focus"];
    default:
      return [];
  }
}
