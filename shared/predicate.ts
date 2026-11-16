/**
 * Hard-screen predicate evaluation for the server (rule proposals and
 * projected screen counts). Same semantics as the desk's queue.ts
 * ruleMatches: numeric compare when both sides parse, case-insensitive
 * string equality otherwise, and a missing value never screens a firm.
 */
import { looseText } from "./looseText.js";
import { scoreTraits } from "./rubric/engine.js";
import { thesisOf, traitsOf } from "./rubric/firm.js";
import type { RubricDefinition, TraitDef } from "./rubric/types.js";
import { OPERATORS } from "./vocab.js";

export interface Predicate {
  axis: string;
  operator: string;
  threshold: string;
  model?: string | null;
}

export function ruleKey(
  axis?: string | null,
  operator?: string | null,
  threshold?: string | null,
  model?: string | null,
): string {
  return [axis, operator, threshold, model || "both"]
    .map((s) => (s ?? "").trim().toLowerCase())
    .join("|");
}

/**
 * The pattern a rule expresses, whatever its threshold: its axis, operator and model (an empty
 * model means "both", as in `ruleKey`). Two rules with the same pattern (`deal_size_usd_m < 20` and
 * `deal_size_usd_m < 30`) screen for the same reason, so the learning loop proposes at most one rule
 * per pattern. A CS-only rule and a CF-only rule screen different firms, so they are two patterns.
 */
export function rulePatternKey(
  axis?: string | null,
  operator?: string | null,
  model?: string | null,
): string {
  return [axis, operator, model || "both"].map((s) => (s ?? "").trim().toLowerCase()).join("|");
}

/**
 * Every pattern key a rule of this axis, operator and model overlaps: its own, plus the other
 * scopes it shares firms with. A rule for both models overlaps a CF-only and a CS-only rule; CF and
 * CS overlap only through "both".
 */
export function overlappingPatternKeys(
  axis?: string | null,
  operator?: string | null,
  model?: string | null,
): string[] {
  const scope = (model ?? "").trim().toLowerCase();
  const scopes = scope === "cf" || scope === "cs" ? [scope, "both"] : ["both", "cf", "cs"];
  return scopes.map((m) => rulePatternKey(axis, operator, m));
}

/**
 * The rubric's own hard-reject this predicate repeats, or null. Only an equality can repeat one: a
 * firm whose trait holds the threshold is then hard-rejected by the rubric whatever else is true of
 * it. A rule scoped to both theses repeats a gate when either thesis rejects on it (the generalist
 * gate is a CF gate; the CS rubric does not score coverage at all).
 */
export function rubricGateFor(def: RubricDefinition, p: Predicate): string | null {
  const axis = p.axis.trim().toLowerCase();
  if (p.operator.trim() !== "==" || p.threshold.trim() === "") {
    return null;
  }
  const scope = (p.model ?? "").trim().toLowerCase();
  const theses =
    scope === "" || scope === "both"
      ? def.theses
      : def.theses.filter((t) => t.key.trim().toLowerCase() === scope);
  for (const thesis of theses) {
    const result = scoreTraits(def, thesis.key, { [axis]: p.threshold.trim() });
    if (result.hardRejected) {
      return result.rejectReason;
    }
  }
  return null;
}

export function matchesPredicate(firm: Readonly<Record<string, unknown>>, p: Predicate): boolean {
  const scope = (p.model ?? "").trim().toLowerCase();
  const firmScope = (thesisOf(firm) ?? "").trim().toLowerCase();
  if (scope !== "" && scope !== "both" && scope !== firmScope) {
    return false;
  }
  if (!(OPERATORS as readonly string[]).includes(p.operator.trim())) {
    return false;
  }
  return compareValue(traitsOf(firm)[p.axis.trim().toLowerCase()], p.operator, p.threshold);
}

/**
 * The traits a screening rule may test: numbers, and category facts. Evidence labels (a firm's
 * services, its MDs' backgrounds) are the rubric's to judge, and profile fields are never screened.
 */
export function predicateAxes(traits: readonly TraitDef[]): string[] {
  return traits
    .filter(
      (t) =>
        t.role !== "profile" &&
        (t.kind === "number" || (t.kind === "category" && t.role === "fact")),
    )
    .map((t) => t.traitKey);
}

/**
 * The comparison behind every predicate and hard reject: numeric when both
 * sides parse, case-insensitive string equality otherwise. A missing value
 * never matches.
 */
export function compareValue(value: unknown, operator: string, threshold: string): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  const op = operator.trim();
  const t = threshold.trim();
  const a = typeof value === "number" ? value : Number(value);
  const b = Number(t);
  if (Number.isFinite(a) && Number.isFinite(b) && t !== "") {
    switch (op) {
      case "<":
        return a < b;
      case "<=":
        return a <= b;
      case ">":
        return a > b;
      case ">=":
        return a >= b;
      case "==":
        return a === b;
      case "!=":
        return a !== b;
    }
  }
  const eq = looseText(value).trim().toLowerCase() === t.toLowerCase();
  if (op === "==") {
    return eq;
  }
  if (op === "!=") {
    return !eq;
  }
  return false;
}
