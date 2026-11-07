import { axisLabel } from "./axisLabels.js";

/**
 * Hard-screen predicate rendering.
 *
 * `axis operator threshold`, with numeric thresholds bare and everything
 * else quoted — "employees < 10", 'coverage_model == "Generalist Focus"'.
 * Shared by /rules (the card headline and the version history) and Home's
 * pending-rules card, so the predicate an analyst reads on the home page
 * is character-identical to the one they approve.
 *
 * Returns null when any component is missing: the caller renders a
 * "malformed proposal" placeholder rather than `? ? "?"`.
 */
export function summarizePredicate(
  axis: string | undefined,
  operator: string | undefined,
  threshold: string | undefined,
): string | null {
  const a = (axis ?? "").trim();
  const o = (operator ?? "").trim();
  const t = (threshold ?? "").trim();
  if (a === "" || o === "" || t === "") {
    return null;
  }
  const rhs = /^-?\d+(\.\d+)?$/.test(t) ? t : `"${t}"`;
  return `${a} ${o} ${rhs}`;
}

const OPERATOR_WORDS: Readonly<Record<string, string>> = {
  "<": "below",
  "<=": "at most",
  ">": "above",
  ">=": "at least",
  "==": "is",
  "!=": "is not",
};

/**
 * A predicate in words, for a sentence a person reads: "Avg deal size below $20m",
 * "Sector coverage is Generalist Focus". The axis reads as everywhere else (`axisLabels`), the
 * operator as a word, and a deal size carries its unit. `summarizePredicate` stays the exact form
 * the rule cards show. An unusable predicate reads as "a rule with no condition".
 */
export function describePredicate(
  axis: string | undefined,
  operator: string | undefined,
  threshold: string | undefined,
): string {
  const a = (axis ?? "").trim();
  const o = (operator ?? "").trim();
  const t = (threshold ?? "").trim();
  if (a === "" || o === "" || t === "") {
    return "a rule with no condition";
  }
  const isDealSize = a.toLowerCase() === "deal_size_usd_m";
  const value = isDealSize && /^-?\d+(\.\d+)?$/.test(t) ? `$${t}m` : t;
  return `${axisLabel(a)} ${OPERATOR_WORDS[o] ?? o} ${value}`;
}
