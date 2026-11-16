/**
 * Lookalike firms: the firms in the universe that look most like a target, each with the reasons
 * it was picked. Pure: no React, no data access. It runs in the browser over the firms a page has
 * already loaded, so it does one pass over the universe per target (O(n) for up to 700 firms,
 * with a small bounded list for the best k) and never asks the server for anything.
 *
 * Similarity reads only fields on the firm record. Each field the target has a value for is
 * compared with the same field on the candidate, and a candidate earns that field's weight when
 * the two agree: the same text, or two numbers within 10% of each other. A field either side
 * leaves empty (or, for an amount, at zero) is never a match. The score is the share of the target's comparable weight that
 * the candidate matched, 0 to 100. Every reason names a field that matched and the two values, so
 * a reason can never say something the record does not.
 *
 * Passed firms stay in the results. They are not hidden, because the analyst should see that a
 * lookalike was turned down and why, rather than wonder why it is missing. The pages flag them
 * with a Passed chip (see `LookalikeRow.passed`).
 *
 * Ties break by firm id, so the same firms always come back in the same order.
 */
import type { FirmLike } from "./exportRows.js";
import { bucketOf } from "./pipelineBuckets.js";
import type { Lifecycle } from "./pipelineBuckets.js";
import { traitsOf } from "./rubric/firm.js";
import type { RubricContext } from "./rubric/types.js";
import { scoreFirm } from "./scoring.js";
import { PASSED } from "./vocab.js";

/** How many lookalikes a "More like this" panel shows. */
export const DEFAULT_K = 5;
/** How many lookalikes of approved targets the Pipeline lists. */
export const APPROVED_CAP = 20;
/**
 * A target needs at least this many fields on file before anything is called like it. With fewer,
 * one shared field would read as a near-perfect match on thin evidence.
 */
export const MIN_COMPARABLE_FIELDS = 3;
/** Two numbers match when they differ by no more than this share of the larger. */
const TOLERANCE_PERCENT = 10;

export interface Lookalike {
  firmId: string;
  /** 0 to 100: the share of the target's comparable fields this firm matched, by weight. */
  score: number;
  /** How many fields matched, out of `compared`: the plain count the pages show. */
  matched: number;
  /** How many fields the target has on file to compare. */
  compared: number;
  /** One line per matched field, with the value: "Same sub-sector: Healthcare". */
  reasons: string[];
}

/** A compared field: a Firm property, or a trait key when `trait` is set. */
interface TextFeature {
  key: string;
  weight: number;
  label: string;
  show: (value: string) => string;
}

interface NumberFeature {
  key: string;
  weight: number;
  label: string;
  show: (value: number) => string;
}

const same = (value: string): string => value;
const round1 = (n: number): string => String(Math.round(n * 10) / 10);

/** The firm-level fields every workspace has. The sub-sector is the heaviest signal: firms that cover the same space compete for the same deals. */
const FIRM_FEATURES: readonly Omit<TextFeature, "show">[] = [
  { key: "sector", weight: 6, label: "Same sub-sector" },
  { key: "thesis", weight: 4, label: "Same model" },
  { key: "hqCountry", weight: 4, label: "Same HQ country" },
];

/**
 * How much a shared trait value counts, by trait key. A category fact or profile trait the table
 * does not name still counts, at weight 2; a number trait counts only when named here.
 */
const TRAIT_TEXT: Readonly<Record<string, { weight: number; label: string }>> = {
  coverage_model: { weight: 4, label: "Same coverage model" },
  revenue_band: { weight: 3, label: "Same revenue band" },
  ownership: { weight: 2, label: "Same ownership" },
  succession_risk: { weight: 2, label: "Same succession risk" },
};

const NUMBER_FEATURES: readonly NumberFeature[] = [
  {
    key: "deal_size_usd_m",
    weight: 4,
    label: `Deal size within ${TOLERANCE_PERCENT}%`,
    show: (n) => `$${round1(n)}m`,
  },
  {
    key: "deals_per_md_l3y",
    weight: 4,
    label: `Deal velocity within ${TOLERANCE_PERCENT}%`,
    show: (n) => `${round1(n)} deals per MD`,
  },
];

/** The text fields compared, in reason order: sector, then the category traits, then model and HQ. */
function textFeatures(rubric: RubricContext): TextFeature[] {
  const thesisName = (value: string): string =>
    rubric.definition.theses.find((t) => t.key.toLowerCase() === value.trim().toLowerCase())
      ?.label ?? value.trim();
  const firm = (key: string): TextFeature => {
    const f = FIRM_FEATURES.find((x) => x.key === key) as Omit<TextFeature, "show">;
    return { ...f, show: key === "thesis" ? thesisName : same };
  };
  const traits = rubric.traits
    .filter((t) => t.kind === "category" && t.role !== "evidence")
    .map((t): TextFeature => {
      const known = TRAIT_TEXT[t.traitKey];
      return {
        key: t.traitKey,
        weight: known?.weight ?? 2,
        label: known?.label ?? `Same ${t.label.toLowerCase()}`,
        show: same,
      };
    });
  // Coverage reads beside the sector, the profile traits after the HQ country (the order the
  // reasons have always been listed in).
  const facts = traits.filter(
    (t) => rubric.traits.find((x) => x.traitKey === t.key)?.role === "fact",
  );
  const profile = traits.filter((t) => !facts.includes(t));
  return [firm("sector"), ...facts, firm("thesis"), firm("hqCountry"), ...profile];
}

function numberFeatures(rubric: RubricContext): NumberFeature[] {
  return NUMBER_FEATURES.filter((f) =>
    rubric.traits.some((t) => t.traitKey === f.key && t.kind === "number"),
  );
}

const FIRM_KEYS: ReadonlySet<string> = new Set(FIRM_FEATURES.map((f) => f.key));

/** A feature's value on a firm: the Firm property for a firm-level field, else the trait. */
function valueOf(firm: FirmLike, feature: { key: string }): unknown {
  return FIRM_KEYS.has(feature.key)
    ? firm[feature.key as keyof FirmLike]
    : traitsOf(firm)[feature.key];
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t === "" ? null : t;
};
/**
 * A usable amount: finite and above zero. Deal size and deal velocity are never really zero for an
 * advisory firm, so a 0 is read as "not entered" and is not compared (two zeros would otherwise
 * claim a match that nothing supports).
 */
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/** Equal, or apart by no more than the tolerance share of the larger one (integer arithmetic on the ratio). */
function within(a: number, b: number): boolean {
  return a === b || 100 * Math.abs(a - b) <= TOLERANCE_PERCENT * Math.max(Math.abs(a), Math.abs(b));
}

interface Profile {
  texts: Array<{ feature: TextFeature; value: string; folded: string }>;
  numbers: Array<{ feature: NumberFeature; value: number }>;
  /** The most a candidate can earn: the weight of every field the target has a value for. */
  total: number;
}

function profileOf(rubric: RubricContext, target: FirmLike): Profile {
  const texts: Profile["texts"] = [];
  const numbers: Profile["numbers"] = [];
  let total = 0;
  for (const feature of textFeatures(rubric)) {
    const value = text(valueOf(target, feature));
    if (value !== null) {
      texts.push({ feature, value, folded: value.toLowerCase() });
      total += feature.weight;
    }
  }
  for (const feature of numberFeatures(rubric)) {
    const value = num(valueOf(target, feature));
    if (value !== null) {
      numbers.push({ feature, value });
      total += feature.weight;
    }
  }
  return { texts, numbers, total };
}

interface Match {
  firm: FirmLike;
  firmId: string;
  weight: number;
  count: number;
}

type TextEntry = Profile["texts"][number];
type NumberEntry = Profile["numbers"][number];

/** The candidate's value for a text field when it equals the target's, else null. */
function textHit({ feature, folded }: TextEntry, candidate: FirmLike): string | null {
  const theirs = text(valueOf(candidate, feature));
  return theirs !== null && theirs.toLowerCase() === folded ? theirs : null;
}

/** The candidate's value for a number field when it is within tolerance of the target's, else null. */
function numberHit({ feature, value }: NumberEntry, candidate: FirmLike): number | null {
  const theirs = num(valueOf(candidate, feature));
  return theirs !== null && within(value, theirs) ? theirs : null;
}

/** Weight and count of the fields that matched; no strings are built here, only for the kept few. */
function compare(profile: Profile, candidate: FirmLike): Match | null {
  let weight = 0;
  let count = 0;
  for (const entry of profile.texts) {
    if (textHit(entry, candidate) !== null) {
      weight += entry.feature.weight;
      count += 1;
    }
  }
  for (const entry of profile.numbers) {
    if (numberHit(entry, candidate) !== null) {
      weight += entry.feature.weight;
      count += 1;
    }
  }
  return weight === 0 ? null : { firm: candidate, firmId: candidate.firmId ?? "", weight, count };
}

/** One line per matched field, naming the field and the values that matched. */
function reasonsOf(profile: Profile, candidate: FirmLike): string[] {
  const reasons: string[] = [];
  for (const entry of profile.texts) {
    const theirs = textHit(entry, candidate);
    if (theirs !== null) {
      reasons.push(`${entry.feature.label}: ${entry.feature.show(theirs)}`);
    }
  }
  for (const entry of profile.numbers) {
    const theirs = numberHit(entry, candidate);
    if (theirs !== null) {
      reasons.push(
        `${entry.feature.label}: ${entry.feature.show(entry.value)} vs ${entry.feature.show(theirs)}`,
      );
    }
  }
  return reasons;
}

/** Best first: more matched weight, then the lower firm id. */
const better = (a: Match, b: Match): boolean =>
  a.weight !== b.weight ? a.weight > b.weight : a.firmId < b.firmId;

/**
 * The `k` firms in `universe` most like `target`, best first. The target itself is never in the
 * result, and a firm that matches on nothing is not a lookalike, so fewer than `k` may come back.
 * A target with fewer than MIN_COMPARABLE_FIELDS fields on file has no lookalikes.
 */
export function lookalikes(
  rubric: RubricContext,
  target: FirmLike,
  universe: readonly FirmLike[],
  k: number = DEFAULT_K,
): Lookalike[] {
  const profile = profileOf(rubric, target);
  const compared = profile.texts.length + profile.numbers.length;
  if (compared < MIN_COMPARABLE_FIELDS || k <= 0) {
    return [];
  }
  const targetId = target.firmId ?? "";
  // A short list kept in order: a candidate is inserted if it beats the current last place.
  const best: Match[] = [];
  for (const candidate of universe) {
    const id = candidate.firmId ?? "";
    if (id === "" || id === targetId) {
      continue;
    }
    const match = compare(profile, candidate);
    if (match === null || (best.length === k && !better(match, best[k - 1]))) {
      continue;
    }
    let at = best.length;
    while (at > 0 && better(match, best[at - 1])) {
      at -= 1;
    }
    best.splice(at, 0, match);
    if (best.length > k) {
      best.pop();
    }
  }
  return best.map((m) => ({
    firmId: m.firmId,
    score: Math.round((100 * m.weight) / profile.total),
    matched: m.count,
    compared,
    reasons: reasonsOf(profile, m.firm),
  }));
}

// ─── Rows a page can show ───────────────────────────────────────────────

/** A lookalike with what a list needs to show it: name, tier, stage and whether it was passed. */
export interface LookalikeRow extends Lookalike {
  name: string;
  /** The live tier from the rubric: A, B, C or Rejected. */
  tier: string;
  stage: Lifecycle;
  /** True for a firm already turned down. It is listed, flagged, rather than hidden. */
  passed: boolean;
}

function describe(
  rubric: RubricContext,
  found: readonly Lookalike[],
  byId: ReadonlyMap<string, FirmLike>,
): LookalikeRow[] {
  const rows: LookalikeRow[] = [];
  for (const l of found) {
    const firm = byId.get(l.firmId);
    if (firm === undefined) {
      continue;
    }
    const live = scoreFirm(rubric.definition, firm);
    const stage = bucketOf(firm, live);
    rows.push({
      ...l,
      name: text(firm.firmName) ?? l.firmId,
      tier: live.tier,
      stage,
      passed: stage === PASSED,
    });
  }
  return rows;
}

const indexById = (firms: readonly FirmLike[]): Map<string, FirmLike> =>
  new Map(firms.filter((f) => (f.firmId ?? "") !== "").map((f) => [f.firmId as string, f]));

/** "More like this" for one firm: its closest lookalikes among `firms`. Empty if the firm is unknown. */
export function moreLikeThis(
  rubric: RubricContext,
  firmId: string,
  firms: readonly FirmLike[],
  k: number = DEFAULT_K,
): LookalikeRow[] {
  const byId = indexById(firms);
  const target = byId.get(firmId);
  return target === undefined ? [] : describe(rubric, lookalikes(rubric, target, firms, k), byId);
}

/** A lookalike of the approved set, with the approved firm it is closest to. */
export interface ApprovedLookalike extends LookalikeRow {
  basedOn: { firmId: string; name: string };
}

/**
 * The union of the lookalikes of every approved target, for the Pipeline. A firm that is itself
 * approved is left out, a firm that is like several targets appears once with its best score
 * (the lower firm id breaks a tie between targets), and the list is cut to `cap`, best first.
 *
 * Each target contributes at most `cap` firms: any firm in the overall top `cap` is within the
 * top `cap` of the target it is closest to, so nothing that belongs in the result is lost.
 */
export function lookalikesOfApproved(
  rubric: RubricContext,
  approved: readonly FirmLike[],
  universe: readonly FirmLike[],
  cap: number = APPROVED_CAP,
): ApprovedLookalike[] {
  const approvedIds = new Set(approved.map((f) => f.firmId ?? ""));
  const candidates = universe.filter((f) => !approvedIds.has(f.firmId ?? ""));
  const byId = indexById(universe);
  const bestFor = new Map<string, { found: Lookalike; targetId: string }>();
  for (const target of approved) {
    const targetId = target.firmId ?? "";
    for (const found of lookalikes(rubric, target, candidates, cap)) {
      const held = bestFor.get(found.firmId);
      if (
        held === undefined ||
        found.score > held.found.score ||
        (found.score === held.found.score && targetId < held.targetId)
      ) {
        bestFor.set(found.firmId, { found, targetId });
      }
    }
  }
  const ranked = [...bestFor.values()]
    .sort((a, b) =>
      a.found.score !== b.found.score
        ? b.found.score - a.found.score
        : a.found.firmId < b.found.firmId
          ? -1
          : 1,
    )
    .slice(0, Math.max(0, cap));
  const rows = describe(
    rubric,
    ranked.map((r) => r.found),
    byId,
  );
  const basedOn = new Map(ranked.map((r) => [r.found.firmId, r.targetId] as const));
  return rows.map((row) => {
    const targetId = basedOn.get(row.firmId) ?? "";
    const target = byId.get(targetId);
    return { ...row, basedOn: { firmId: targetId, name: text(target?.firmName) ?? targetId } };
  });
}
