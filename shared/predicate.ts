/**
 * Hard-screen predicate evaluation for the server (rule proposals and
 * projected screen counts). Same semantics as the desk's queue.ts
 * ruleMatches: numeric compare when both sides parse, case-insensitive
 * string equality otherwise, and a missing value never screens a firm.
 */
import { looseText } from "./looseText.js";
import { type Model, type ScoreInput, mirrorScore } from "./scoreMirror.js";
import { OPERATORS } from "./vocab.js";

export interface Predicate {
  axis: string;
  operator: string;
  threshold: string;
  model?: string | null;
}

const AXIS_FIELD: Readonly<Record<string, string>> = {
  employees: "employees",
  deal_size_usd_m: "dealSizeMUsd",
  deals_per_md_l3y: "dealsPerMdL3y",
  firm_age: "firmAge",
  fee_generating_count: "feeGeneratingCount",
  geo_score: "geoScore",
  coverage_model: "coverageModel",
};

export const PREDICATE_AXES = Object.keys(AXIS_FIELD) as readonly string[];

export function predicateField(axis: string): string | null {
  return AXIS_FIELD[axis.trim().toLowerCase()] ?? null;
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
 * firm whose field holds the threshold is then hard-rejected by the rubric (`mirrorScore`) whatever
 * else is true of it. A rule scoped to both models repeats a gate when either model's rubric
 * rejects on it (the generalist gate is a CF gate; the CS rubric does not score coverage at all).
 */
export function rubricGateFor(p: Predicate): string | null {
  const field = predicateField(p.axis);
  if (field === null || p.operator.trim() !== "==" || p.threshold.trim() === "") {
    return null;
  }
  const scope = (p.model ?? "").trim().toUpperCase();
  const models: Model[] = scope === "CF" ? ["CF"] : scope === "CS" ? ["CS"] : ["CF", "CS"];
  for (const model of models) {
    const input: ScoreInput = { firmType: model, [field]: p.threshold.trim() };
    const result = mirrorScore(input);
    if (result.hardRejected) {
      return result.rejectReason;
    }
  }
  return null;
}

export function matchesPredicate(firm: Readonly<Record<string, unknown>>, p: Predicate): boolean {
  const scope = (p.model ?? "").trim().toLowerCase();
  const firmScope =
    looseText(firm.firmType ?? "")
      .trim()
      .toLowerCase() === "cs"
      ? "cs"
      : "cf";
  if (scope !== "" && scope !== "both" && scope !== firmScope) {
    return false;
  }

  const field = predicateField(p.axis);
  if (field === null || !(OPERATORS as readonly string[]).includes(p.operator.trim())) {
    return false;
  }
  const value = firm[field];
  if (value === null || value === undefined || value === "") {
    return false;
  }

  const op = p.operator.trim();
  const t = p.threshold.trim();
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
