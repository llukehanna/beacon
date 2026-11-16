/**
 * Enrichment Desk - queue prioritizer + shared hard-screen verdict.
 *
 * `computeHardScreen(firm, activeConfigs)` is the ONE source of truth for
 * whether a firm has been screened out. Both the queue's sink decision and
 * the header/badge label read from it, so the two can't disagree.
 *
 * The verdict combines three sources, in this order:
 *   1. The rubric's own hard rejects, for the firm's thesis.
 *   2. Active approved HardScreenConfig rows — learned rules an analyst
 *      has approved via /rules. Filtered to configActive === true before
 *      being passed in, so pending / dismissed proposals never screen.
 *   3. Server disposition string — belt-and-braces for backend flags the
 *      client mirror can't reconstruct.
 *
 * Queue ranking then applies:
 *   • hard-screened → very bottom
 *   • terminal (Qualified or later, or Passed) → above hard-screened
 *   • workable → gain desc, fewer-missing tiebreak
 */
import { looseText } from "./looseText.js";
import { researchedFor } from "./rubric/catalog.js";
import { criterionMax, resolveThesis, scoreTraits } from "./rubric/engine.js";
import { thesisOf, traitsOf } from "./rubric/firm.js";
import type { RubricContext, TraitValue } from "./rubric/types.js";
import { PASSED, isQualifiedOrLater, normalizeLifecycle } from "./vocab.js";

export interface QueueFirm {
  firmId: string;
  firmName?: string | null;
  /** The thesis the firm is scored under (today's column is firmType). */
  firmType?: string | null;
  /** The firm's trait values by trait key. */
  traits?: Record<string, TraitValue>;
  // Lifecycle carried through so the ranker can push Qualified-or-later / Passed
  // firms to the bottom — the desk is a to-do list, not a leaderboard.
  lifecycleState?: string | null;
  currentStage?: string | null;
  // Disposition captures the server's judgement — the server may have
  // flagged the firm through a mechanism the client can't reconstruct.
  // Reading disposition lets us honour the server's decision even when the
  // rubric sees the firm as workable.
  disposition?: string | null;
}

export interface RankedFirm {
  firm: QueueFirm;
  hardRejected: boolean;
  // True when the shared computeHardScreen verdict says the firm was
  // screened out. Both queue partition and header/badge label read from
  // the same function so they can't disagree.
  hardScreened: boolean;
  // Human-readable reason (base rule name / rule predicate / disposition
  // string) — surfaced by the header's "Hard-rejected · <reason>" chip.
  hardScreenReason: string | null;
  terminal: boolean;
  currentScore: number;
  ceiling: number;
  /** The most points the firm's thesis can award. */
  maxPossible: number;
  gain: number;
  missingCount: number;
  tier: string;
}

// ─── Active HardScreenConfig ────────────────────────────────────────────

export interface ActiveConfigRule {
  ruleId: string;
  axis: string; // a trait key (e.g. "deal_size_usd_m", "employees")
  operator: string; // <, <=, >, >=, ==, !=, =, in
  threshold: string; // stringified value; parsed at compare-time
  model: string; // a thesis key or "both" — case-insensitive
}

/**
 * The firm properties the queue reads besides its traits: identity, thesis and lifecycle. The
 * server selects these plus the trait storage; the client loads whole firms.
 */
export const QUEUE_FIELDS: readonly string[] = [
  "firmId",
  "firmName",
  "firmType",
  "lifecycleState",
  "currentStage",
  "disposition",
];

/**
 * The one way to build a queue firm from a loaded Firm object. Home, the desk
 * and the server's homeSummary all rank through this, so a hard-screen rule on
 * a gate axis screens the same firms everywhere.
 */
export function toQueueFirm(firm: object): QueueFirm {
  const f = firm as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of QUEUE_FIELDS) {
    out[k] = f[k];
  }
  out.firmId = f.firmId ?? "";
  out.disposition = f.disposition ?? null;
  out.traits = { ...traitsOf(f) };
  return out as unknown as QueueFirm;
}

function ruleAppliesToFirm(
  rubric: RubricContext,
  rule: ActiveConfigRule,
  firm: QueueFirm,
): boolean {
  const rm = (rule.model ?? "").trim().toLowerCase();
  if (rm === "" || rm === "both") {
    return true;
  }
  return rm === resolveThesis(rubric.definition, thesisOf(firm as never)).key.toLowerCase();
}

// Numeric comparison when both sides parse as numbers; otherwise
// string-equality. `in` treats the threshold as a JSON array (["a","b"])
// with case-insensitive membership. Unknown operators return false rather
// than throw — a malformed rule shouldn't crash the desk.
function ruleMatches(firmValue: unknown, operator: string, threshold: string): boolean {
  if (firmValue === null || firmValue === undefined || firmValue === "") {
    // Missing data can't trip a rule — the analyst still needs to enrich.
    return false;
  }
  const op = operator.trim();
  const t = threshold.trim();

  const numV = typeof firmValue === "number" ? firmValue : Number(firmValue);
  const numT = Number(t);
  const numeric = !Number.isNaN(numV) && !Number.isNaN(numT);

  if (numeric) {
    switch (op) {
      case "<":
        return numV < numT;
      case "<=":
        return numV <= numT;
      case ">":
        return numV > numT;
      case ">=":
        return numV >= numT;
      case "=":
      case "==":
        return numV === numT;
      case "!=":
        return numV !== numT;
      default:
        break;
    }
  }

  // Boolean firm fields — advisoryConflict etc. — arrive as true/false.
  if (typeof firmValue === "boolean") {
    const lit = t.toLowerCase();
    const asBool = lit === "true" ? true : lit === "false" ? false : null;
    if (asBool !== null && (op === "=" || op === "==")) {
      return firmValue === asBool;
    }
  }

  const sV = looseText(firmValue).trim().toLowerCase();
  const sT = t.toLowerCase();
  switch (op) {
    case "=":
    case "==":
      return sV === sT;
    case "!=":
      return sV !== sT;
    case "in": {
      try {
        const arr = JSON.parse(t) as unknown;
        if (Array.isArray(arr)) {
          return arr.map((x) => String(x).trim().toLowerCase()).includes(sV);
        }
      } catch {
        // fall through
      }
      // CSV fallback: "a,b,c"
      return t
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .includes(sV);
    }
    case "contains":
      return sV.includes(sT);
    default:
      return false;
  }
}

function formatRulePredicate(rule: ActiveConfigRule): string {
  const thresholdStr = /^-?\d+(\.\d+)?$/.test(rule.threshold)
    ? rule.threshold
    : `"${rule.threshold}"`;
  return `${rule.axis} ${rule.operator} ${thresholdStr}`;
}

export interface HardScreenVerdict {
  hardScreened: boolean;
  reason: string | null;
  source: "base" | "config" | "disposition" | null;
}

/**
 * The single source of truth for whether a firm is hard-screened. Both the
 * queue's sink partition and the header/badge label call this — they can't
 * disagree.
 *
 * `activeConfigs` should already be filtered to `configActive === true`
 * before it reaches this function; pending / dismissed proposals must
 * never screen.
 */
export function computeHardScreen(
  rubric: RubricContext,
  firm: QueueFirm,
  activeConfigs: readonly ActiveConfigRule[],
): HardScreenVerdict {
  // 1. The rubric's own hard rejects.
  const score = scoreFirmTraits(rubric, firm);
  if (score.hardRejected) {
    return { hardScreened: true, reason: score.rejectReason, source: "base" };
  }
  // 2. Active approved HardScreenConfig rows — evaluate per thesis.
  for (const rule of activeConfigs) {
    if (!ruleAppliesToFirm(rubric, rule, firm)) {
      continue;
    }
    const key = rule.axis.trim().toLowerCase();
    if (!rubric.traits.some((t) => t.traitKey === key)) {
      // Rule targets an axis the catalog doesn't know — safest to skip rather
      // than false-positive the firm.
      continue;
    }
    const value: unknown = traitsOf(firm as never)[key];
    if (ruleMatches(value, rule.operator, rule.threshold)) {
      return {
        hardScreened: true,
        reason: formatRulePredicate(rule),
        source: "config",
      };
    }
  }
  // 3. Server disposition — belt-and-braces if the backend flagged the
  // firm via a mechanism the client can't reconstruct locally.
  if (dispositionMarksHardScreen(firm.disposition)) {
    return {
      hardScreened: true,
      reason: (firm.disposition ?? "").trim() || "server-flagged",
      source: "disposition",
    };
  }
  return { hardScreened: false, reason: null, source: null };
}

function scoreFirmTraits(rubric: RubricContext, firm: QueueFirm) {
  return scoreTraits(rubric.definition, thesisOf(firm as never), traitsOf(firm as never));
}

// Disposition strings that indicate the firm was blocked by a hard-screen
// rule, however encoded server-side. Matched case-insensitively as a
// substring so variants like "hard_rejected" / "hard-screened" / "screened
// out" / "reject: sanctions" all light up.
const HARD_SCREEN_TOKENS = ["reject", "screen", "hard"];

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

// Decided: the firm is Passed or has been qualified (so it is past the
// screening work this queue exists for).
function isTerminal(firm: QueueFirm): boolean {
  return [firm.lifecycleState, firm.currentStage].some((raw) => {
    const state = normalizeLifecycle(raw);
    return state === PASSED || isQualifiedOrLater(state);
  });
}

export function dispositionMarksHardScreen(disposition: string | null | undefined): boolean {
  const d = (disposition ?? "").trim().toLowerCase();
  if (d === "") {
    return false;
  }
  return HARD_SCREEN_TOKENS.some((t) => d.includes(t));
}

export function rankFirm(
  rubric: RubricContext,
  firm: QueueFirm,
  activeConfigs: readonly ActiveConfigRule[] = [],
): RankedFirm {
  const res = scoreFirmTraits(rubric, firm);
  const traits = traitsOf(firm as never);
  // The headroom is what researching the firm could still add: every criterion on a researched
  // trait the firm has no value for, at its full points.
  let missingCount = 0;
  let headroom = 0;
  for (const c of resolveThesis(rubric.definition, res.model).criteria) {
    const trait = rubric.traits.find((t) => t.traitKey === c.traitKey);
    if (trait?.role !== "evidence" || !researchedFor(rubric.definition, trait, res.model)) {
      continue;
    }
    if (isMissing(traits[c.traitKey])) {
      missingCount++;
      headroom += criterionMax(c) * c.weight;
    }
  }
  const currentScore = res.hardRejected ? 0 : res.weightedTotal;
  const ceiling = res.hardRejected ? 0 : Math.min(res.maxPossible, currentScore + headroom);
  const gain = Math.max(0, ceiling - currentScore);
  const verdict = computeHardScreen(rubric, firm, activeConfigs);
  return {
    firm,
    hardRejected: res.hardRejected,
    hardScreened: verdict.hardScreened,
    hardScreenReason: verdict.reason,
    terminal: isTerminal(firm),
    currentScore,
    ceiling,
    maxPossible: res.maxPossible,
    gain,
    missingCount,
    tier: res.tier,
  };
}

export function orderEnrichmentQueue(
  rubric: RubricContext,
  firms: QueueFirm[],
  activeConfigs: readonly ActiveConfigRule[] = [],
): RankedFirm[] {
  return firms
    .map((f) => rankFirm(rubric, f, activeConfigs))
    .sort((a, b) => {
      // 1. Hard-screened firms (any lifecycle) sink to the very bottom —
      //    enrichment is worthless because the screen already made the call.
      //    This must run before the terminal check so a Discovered-but-
      //    hard-screened firm doesn't slip into the workable band via a
      //    high fictional "gain".
      if (a.hardScreened !== b.hardScreened) {
        return a.hardScreened ? 1 : -1;
      }
      // 2. Terminal firms (Qualified or later, or Passed) drop below active
      //    work but above hard-screened.
      if (a.terminal !== b.terminal) {
        return a.terminal ? 1 : -1;
      }
      // 3. Among working firms, highest expected gain first — the most points
      //    on the table for one analyst pass.
      if (a.gain !== b.gain) {
        return b.gain - a.gain;
      }
      // 4. Tiebreak: fewer missing fields → closer to a decision.
      if (a.missingCount !== b.missingCount) {
        return a.missingCount - b.missingCount;
      }
      // 5. Deterministic final tiebreak so the order is stable across renders.
      return a.firm.firmId.localeCompare(b.firm.firmId);
    });
}
