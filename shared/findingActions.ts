// Pure helpers for wiring Findings-panel Accept / Verify buttons into the
// analyst's edit map. Kept out of the firmDesk components so the conflict-detection logic
// is unit-testable without a React harness.
//
// A finding's axis is a trait key, and so is every edit key: the edit map is applied to
// enrichFirm as `traitValues`. What a trait's input looks like, how a raw value coerces, and
// how a value reads all come from the trait catalog.
import { type FindingLike, isVerifiedFinding, pickAuthoritative } from "./axisState.js";
import { traitFor } from "./rubric/catalog.js";
import { traitsOf } from "./rubric/firm.js";
import { parseTraitValue, showTraitValue } from "./rubric/traitValue.js";
import type { RubricContext, TraitDef } from "./rubric/types.js";

/** The catalog trait a finding axis (or edit key) names; undefined when the catalog has none. */
export function traitOfAxis(
  rubric: RubricContext,
  axisOrKey: string | null | undefined,
): TraitDef | undefined {
  return traitFor(rubric.traits, axisOrKey ?? "");
}

export type AxisInputKind = "boolean" | "number" | "enum" | "text";

const INPUT_KIND: Record<TraitDef["kind"], AxisInputKind> = {
  yesno: "boolean",
  number: "number",
  category: "enum",
};

// Resolve the input shape for an "axis abstained — needs you" cell.
export function axisInputKind(rubric: RubricContext, axisOrKey: string): AxisInputKind {
  const trait = traitOfAxis(rubric, axisOrKey);
  return trait === undefined ? "text" : INPUT_KIND[trait.kind];
}

// Coerce a finding's raw string value into the shape enrichFirm expects
// for this trait. Returns undefined when the value can't be routed — the
// caller must surface that instead of silently no-op'ing.
export function coerceFindingValue(
  rubric: RubricContext,
  traitKey: string,
  raw: string | null | undefined,
): string | number | boolean | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const trait = traitOfAxis(rubric, traitKey);
  const kind = trait?.kind ?? "category";
  return parseTraitValue({ kind }, raw) ?? undefined;
}

// Loose current-value read: prefer the analyst's in-progress edit, else
// fall back to whatever's on the firm. Returns null/undefined
// verbatim so the caller can tell "unset" from "explicitly false".
export function effectiveAxisValue(
  firm: object,
  edits: Record<string, string | number | boolean>,
  traitKey: string,
): string | number | boolean | null | undefined {
  if (Object.prototype.hasOwnProperty.call(edits, traitKey)) {
    return edits[traitKey];
  }
  return traitsOf(firm as Record<string, unknown>)[traitKey];
}

// Normalized "is there an analyst-provided value here?" check. Empty strings
// and null/undefined all read as "unset"; a legitimate `false` on a hard
// gate counts as set.
function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) {
    return false;
  }
  if (typeof v === "string" && v.trim() === "") {
    return false;
  }
  return true;
}

// Compare two axis values loosely enough that "150" and 150 match, and
// "Yes"/true don't cross wires — hard gates coerce upstream so both sides
// are booleans by the time they reach here.
function valuesMatch(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export type AcceptDecision =
  | { kind: "apply"; editKey: string; value: string | number | boolean }
  | {
      kind: "conflict";
      editKey: string;
      mine: string | number | boolean;
      theirs: string | number | boolean;
    }
  | { kind: "unroutable"; reason: "unknown-axis" | "uncoercible-value" };

function routed(
  rubric: RubricContext,
  finding: { axis?: string | null; value?: string | null },
):
  | { editKey: string; theirs: string | number | boolean }
  | Extract<AcceptDecision, { kind: "unroutable" }> {
  const trait = traitOfAxis(rubric, finding.axis);
  if (trait === undefined) {
    return { kind: "unroutable", reason: "unknown-axis" };
  }
  const theirs = coerceFindingValue(rubric, trait.traitKey, finding.value ?? "");
  if (theirs === undefined) {
    return { kind: "unroutable", reason: "uncoercible-value" };
  }
  return { editKey: trait.traitKey, theirs };
}

// Decide what should happen when the analyst clicks Accept on a proposed
// finding. Never silently no-ops on conflict — the caller must render the
// Keep-mine / Take-agent's choice when kind === "conflict".
export function decideAccept(
  rubric: RubricContext,
  finding: { axis?: string | null; value?: string | null },
  current: string | number | boolean | null | undefined,
): AcceptDecision {
  const r = routed(rubric, finding);
  if ("kind" in r) {
    return r;
  }
  const { editKey, theirs } = r;
  if (!hasValue(current) || valuesMatch(current, theirs)) {
    return { kind: "apply", editKey, value: theirs };
  }
  return { kind: "conflict", editKey, mine: current as string | number | boolean, theirs };
}

// Verify semantics: "confirm the current value as human-checked (writing
// it if absent)". If the axis is empty, write the finding value; if it
// already matches, no-op on the write; if it differs, don't overwrite —
// surface a conflict so the analyst chooses (same UI as Accept).
export function decideVerify(
  rubric: RubricContext,
  finding: { axis?: string | null; value?: string | null },
  current: string | number | boolean | null | undefined,
): AcceptDecision {
  return decideAccept(rubric, finding, current);
}

// Rebuild the staged-edit baseline from human-verified findings.
//
// Clicking Verify stages the finding's value into the edit map AND marks
// the finding verified server-side — but the edit map is session state.
// A reload (or navigating away and back) keeps the finding verified while
// silently dropping its value from the preview score and the commit
// payload: the desk then shows "9 verified" next to blank axes, and Commit
// enrichment has nothing to send. This derives the edits a fresh session
// must re-stage: for every axis whose authoritative finding is verified
// and which currently has no value, stage the finding's value again.
// Persisted firm values and in-session analyst edits always win — only
// unset axes are filled — so callers can re-run this until it returns [].
// Conflict-grouped findings are excluded: staging their values is the
// resolve flow's job, not the baseline's.
export function verifiedBaselineEdits(
  rubric: RubricContext,
  findings: readonly FindingLike[],
  getCurrent: (editKey: string) => string | number | boolean | null | undefined,
): Array<{ editKey: string; value: string | number | boolean }> {
  const byTrait = new Map<string, FindingLike[]>();
  for (const f of findings) {
    if ((f.findingStatus ?? "").toLowerCase() === "superseded") {
      continue;
    }
    const gid = f.conflictGroupId;
    if (gid !== null && gid !== undefined && gid !== "") {
      continue;
    }
    const trait = traitOfAxis(rubric, f.axis);
    if (trait === undefined) {
      continue;
    }
    byTrait.set(trait.traitKey, [...(byTrait.get(trait.traitKey) ?? []), f]);
  }

  const out: Array<{ editKey: string; value: string | number | boolean }> = [];
  for (const [editKey, arr] of byTrait) {
    const auth = pickAuthoritative(arr);
    if (!isVerifiedFinding(auth)) {
      continue;
    }
    const value = coerceFindingValue(rubric, editKey, auth.value ?? "");
    if (value === undefined || hasValue(getCurrent(editKey))) {
      continue;
    }
    out.push({ editKey, value });
  }
  return out;
}

// Coerce a raw finding value string through the trait's type and render it
// for a person. This is the ONE entry point for showing a finding.value to
// the analyst — every card that renders one (proposed, history, abstained,
// conflict pair) calls this so gate findings never leak "true / false" or
// "yes / no" into the UI. When the axis isn't in the catalog or the value
// can't be coerced, we fall through to the raw string so malformed data
// still shows *something* instead of an empty cell.
//
// Units are for people reading a screen. The MCP tools and the exports hand the value on to other
// programs and spreadsheets, so they pass `{ units: false }` and get the bare number back.
export function displayFindingValue(
  rubric: RubricContext,
  rawAxis: string | null | undefined,
  rawValue: string | null | undefined,
  options: { units?: boolean } = {},
): string {
  const raw = (rawValue ?? "").trim();
  if (raw === "") {
    return "—";
  }
  const trait = traitOfAxis(rubric, rawAxis);
  if (trait === undefined) {
    return raw;
  }
  const coerced = parseTraitValue(trait, raw);
  return coerced === null
    ? raw
    : showTraitValue(trait, coerced, { units: (options.units ?? true) ? "currency" : "none" });
}

// Human-facing rendering of a value by edit key. Kept symmetric between
// "mine" and "theirs" in the conflict prompt copy. Hard gates read as
// Pass / Fail per their polarity — the raw booleans never leak into copy.
export function formatAxisValue(
  rubric: RubricContext,
  traitKey: string,
  v: string | number | boolean | null | undefined,
  units = true,
): string {
  const trait = traitOfAxis(rubric, traitKey);
  if (trait === undefined) {
    return v === null || v === undefined || v === "" ? "—" : String(v);
  }
  return showTraitValue(trait, v, { units: units ? "currency" : "none" });
}

/** Whether a trait is a yes/no gate (its analyst input is a boolean). */
export function isGateTrait(rubric: RubricContext, traitKey: string): boolean {
  return traitOfAxis(rubric, traitKey)?.kind === "yesno";
}
