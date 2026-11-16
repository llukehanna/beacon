/**
 * The generic scoring engine. It knows nothing about any team: every number,
 * label, and rule comes from the RubricDefinition it is handed.
 */
import { compareValue } from "../predicate.js";
import type {
  Action,
  AxisScore,
  Criterion,
  RubricDefinition,
  ScoreResult,
  ThesisDef,
  Tier,
  TraitValue,
  Traits,
} from "./types.js";

const norm = (s: string): string => s.trim().toLowerCase();

function toNumber(v: TraitValue | null | undefined): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The thesis matching `thesisKey` (trimmed, case-insensitive), else the default. */
export function resolveThesis(
  def: RubricDefinition,
  thesisKey: string | null | undefined,
): ThesisDef {
  const want = norm(thesisKey ?? "");
  const hit = def.theses.find((t) => norm(t.key) === want);
  if (hit) {
    return hit;
  }
  const fallback = def.theses.find((t) => norm(t.key) === norm(def.defaultThesis));
  if (!fallback) {
    throw new Error(`Rubric default thesis "${def.defaultThesis}" is not declared`);
  }
  return fallback;
}

export function criterionMax(c: Criterion): number {
  const s = c.scoring;
  if (s.type === "direct") {
    return s.max;
  }
  const pts = s.type === "category" ? s.options.map((o) => o.points) : s.bands.map((b) => b.points);
  return Math.max(...pts);
}

export function maxPossible(thesis: ThesisDef): number {
  return thesis.criteria.reduce((sum, c) => sum + criterionMax(c) * c.weight, 0);
}

const unknown = (axis: string): AxisScore => ({ axis, score: 0, band: "Unknown", known: false });

function scoreCriterion(c: Criterion, v: TraitValue | null | undefined): AxisScore {
  const s = c.scoring;
  if (v === null || v === undefined) {
    return unknown(c.label);
  }
  if (s.type === "category") {
    const hit = s.options.find((o) => norm(o.value) === norm(String(v)));
    return hit
      ? { axis: c.label, score: hit.points, band: String(v), known: true }
      : unknown(c.label);
  }
  const x = toNumber(v);
  if (x === null) {
    return unknown(c.label);
  }
  if (s.type === "direct") {
    const score = Math.max(s.min, Math.min(s.max, x));
    return { axis: c.label, score, band: `${c.traitKey}=${score}`, known: true };
  }
  const band = s.bands.find(
    (b) =>
      (b.min === undefined || (b.minInclusive ? x >= b.min : x > b.min)) &&
      (b.max === undefined || (b.maxInclusive ? x <= b.max : x < b.max)),
  );
  return band
    ? { axis: c.label, score: band.points, band: band.label, known: true }
    : unknown(c.label);
}

function firstHardReject(thesis: ThesisDef, traits: Traits): string | null {
  for (const r of thesis.hardRejects) {
    if (compareValue(traits[r.traitKey], r.operator, r.value)) {
      return r.reason;
    }
  }
  return null;
}

function tierFor(thesis: ThesisDef, total: number): Tier {
  const t = thesis.tiers;
  return total >= t.A ? "A" : total >= t.B ? "B" : total >= t.C ? "C" : "Rejected";
}

function actionFor(thesis: ThesisDef, tier: Tier, total: number): Action {
  const up = thesis.actions.upgrades.find((u) => u.tier === tier && total >= u.minPoints);
  return up ? up.action : thesis.actions[tier];
}

export function scoreTraits(
  def: RubricDefinition,
  thesisKey: string | null | undefined,
  traits: Traits,
): ScoreResult {
  const thesis = resolveThesis(def, thesisKey);
  const max = maxPossible(thesis);
  const rejectReason = firstHardReject(thesis, traits);
  if (rejectReason !== null) {
    return {
      model: thesis.key,
      hardRejected: true,
      rejectReason,
      weightedTotal: 0,
      maxPossible: max,
      pct: 0,
      tier: "Rejected",
      action: "Reject",
      confidence: 1,
      axisScores: [],
    };
  }
  const axisScores = thesis.criteria.map((c) => scoreCriterion(c, traits[c.traitKey]));
  const weightedTotal = thesis.criteria.reduce(
    (sum, c, i) => sum + axisScores[i].score * c.weight,
    0,
  );
  const tier = tierFor(thesis, weightedTotal);
  return {
    model: thesis.key,
    hardRejected: false,
    rejectReason: "",
    weightedTotal,
    maxPossible: max,
    pct: max > 0 ? weightedTotal / max : 0,
    tier,
    action: actionFor(thesis, tier, weightedTotal),
    confidence: axisScores.filter((a) => a.known).length / axisScores.length,
    axisScores,
  };
}

/**
 * Unweighted points one value earns on its criterion, scored in isolation so
 * other traits can't mask it. Null when the thesis doesn't score the trait or
 * the value is missing or unrecognized; 0 when the value alone disqualifies.
 */
export function criterionPoints(
  def: RubricDefinition,
  thesisKey: string | null | undefined,
  traitKey: string,
  value: TraitValue | null,
): number | null {
  const thesis = resolveThesis(def, thesisKey);
  const c = thesis.criteria.find((x) => x.traitKey === traitKey);
  if (!c || value === null) {
    return null;
  }
  if (firstHardReject(thesis, { [traitKey]: value }) !== null) {
    return 0;
  }
  const s = scoreCriterion(c, value);
  return s.known ? s.score : null;
}
