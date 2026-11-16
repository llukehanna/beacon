import type { ActionParams } from "./actionParams.js";
import { axisLabel } from "./axisLabels.js";
import { type FindingLike, retrievedMs } from "./axisState.js";
import { isGateTrait, traitOfAxis } from "./findingActions.js";
import { criterionFor, optionsFor, researchedFor } from "./rubric/catalog.js";
import { resolveThesis, scoreTraits } from "./rubric/engine.js";
import { thesisOf, traitsOf } from "./rubric/firm.js";
import { showTraitValue } from "./rubric/traitValue.js";
import type { RubricContext, ScoreResult, TraitValue, Traits } from "./rubric/types.js";

export interface FirmView {
  firmId?: string;
  firmName?: string | null;
  /** The thesis the firm is scored under (today's column is thesis). */
  thesis?: string | null;
  /** Every catalog trait the firm has a value for, by trait key. */
  traits?: Record<string, TraitValue>;
  geographicFootprint?: string | null;
  hqCountry?: string | null;
  lifecycleState?: string | null;
  currentStage?: string | null;
  sector?: string | null;
  employeeGroup?: string | null;
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

/** Staged analyst edits, by trait key. */
export type EditMap = Record<string, string | number | boolean>;

/** An edit as its trait stores it: numbers typed into a text box become numbers; blanks are left out. */
function editValue(
  rubric: RubricContext,
  key: string,
  v: string | number | boolean,
): TraitValue | null {
  if (v === "") {
    return null;
  }
  return traitOfAxis(rubric, key)?.kind === "number" ? Number(v) : v;
}

/** The enrichFirm call that commits a firm's staged edits; blank edits are left out. */
export function enrichParams(
  rubric: RubricContext,
  firmId: string,
  edits: EditMap,
): ActionParams<"enrichFirm"> {
  const values: Record<string, TraitValue> = {};
  for (const [k, v] of Object.entries(edits)) {
    const value = editValue(rubric, k, v);
    if (value !== null) {
      values[k] = value;
    }
  }
  return {
    firm: firmId,
    traitValues: JSON.stringify(values),
    fieldsEnteredManually: JSON.stringify(Object.keys(edits)),
  };
}

/** The findings' axis label. The one label map is shared/axisLabels. */
export function displayAxis(rubric: RubricContext, raw: string | undefined): string {
  return axisLabel(rubric, raw);
}

/** A firm's traits with the staged edits laid over them: what the preview score reads. */
export function mergedTraits(rubric: RubricContext, firm: FirmView, edits: EditMap): Traits {
  const out: Record<string, TraitValue> = { ...traitsOf(firm as Record<string, unknown>) };
  for (const [k, v] of Object.entries(edits)) {
    const value = editValue(rubric, k, v);
    if (value !== null) {
      out[k] = value;
    }
  }
  return out;
}

/** The firm's score as the rubric gives it, with any staged edits applied. */
export function previewScore(
  rubric: RubricContext,
  firm: FirmView,
  edits: EditMap = {},
): ScoreResult {
  return scoreTraits(
    rubric.definition,
    thesisOf(firm as Record<string, unknown>),
    mergedTraits(rubric, firm, edits),
  );
}

interface CatOption {
  score: number;
  label: string;
}

export interface AxisEditor {
  editKey: string;
  kind: "categorical" | "number";
  options?: CatOption[];
  unit?: string;
}

/**
 * The editor for a researched trait the thesis scores, by trait key: a picklist of the thesis's
 * options (with their points) or a number box with the trait's unit. Undefined for gates, facts,
 * and traits the thesis does not score.
 */
export function editorForEditKey(
  rubric: RubricContext,
  editKey: string,
  thesisKey: string | null | undefined,
): AxisEditor | undefined {
  const trait = traitOfAxis(rubric, editKey);
  if (trait === undefined || trait.role !== "evidence") {
    return undefined;
  }
  if (!researchedFor(rubric.definition, trait, thesisKey)) {
    return undefined;
  }
  const c = criterionFor(rubric.definition, thesisKey, trait.traitKey);
  if (c === undefined) {
    return undefined;
  }
  if (c.scoring.type === "category") {
    return {
      editKey: trait.traitKey,
      kind: "categorical",
      options: c.scoring.options.map((o) => ({ score: o.points, label: o.value })),
    };
  }
  return trait.kind === "number"
    ? { editKey: trait.traitKey, kind: "number", unit: trait.unit ?? undefined }
    : undefined;
}

/** The score's axis name for a trait under the firm's thesis (its criterion's label); undefined when unscored. */
export function criterionLabelFor(
  rubric: RubricContext,
  traitKey: string,
  thesisKey: string | null | undefined,
): string | undefined {
  return criterionFor(rubric.definition, thesisKey, traitKey)?.label;
}

/** The trait key behind a score axis (a criterion label) for the firm's thesis. */
export function traitKeyForAxis(
  rubric: RubricContext,
  axis: string,
  thesisKey: string | null | undefined,
): string | undefined {
  return resolveThesis(rubric.definition, thesisKey).criteria.find((c) => c.label === axis)
    ?.traitKey;
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
 * a missing or unreadable runAt leaves the name alone, and a name that already ends with that day
 * (written by a build before migration 0002) is not given it twice. Empty when the search has neither.
 */
export function searchLabel(
  name: string | null | undefined,
  runAt: string | number | Date | null | undefined,
): string {
  const ms = runAt === null || runAt === undefined ? NaN : new Date(runAt).getTime();
  const day = Number.isNaN(ms) ? "" : new Date(ms).toISOString().slice(0, 10);
  const base = (name ?? "").trim();
  return [base, base.endsWith(day) ? "" : day].filter((part) => part !== "").join(" · ");
}

/** A trait's value on the firm for a person to read ("$40m", "9 yrs"); "—" when unset. */
export function humanAxisValue(rubric: RubricContext, traitKey: string, firm: FirmView): string {
  const trait = traitOfAxis(rubric, traitKey);
  const v = traitsOf(firm as Record<string, unknown>)[traitKey];
  return trait === undefined ? (v === undefined ? "—" : String(v)) : showTraitValue(trait, v);
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
  const thesis = thesisOf(firm as Record<string, unknown>);
  if (thesis !== null) {
    bits.push(thesis);
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

// Format a coerced value as the string verifyFinding's overrideValue
// expects. Yes/no traits read as "Yes" / "No"; everything else stringifies.
export function stringifyOverride(
  rubric: RubricContext,
  editKey: string,
  v: string | number | boolean,
): string {
  if (isGateTrait(rubric, editKey)) {
    return v === true ? "Yes" : v === false ? "No" : String(v);
  }
  return String(v);
}

// The picklist for a category trait under the firm's thesis: its scored options, else the
// catalog's vocabulary. Numbers, yes/no traits and unknown keys have none.
export function enumOptionsFor(
  rubric: RubricContext,
  editKey: string,
  thesisKey: string | null | undefined,
): string[] {
  const trait = traitOfAxis(rubric, editKey);
  return trait?.kind === "category" ? optionsFor(rubric.definition, thesisKey, trait) : [];
}
