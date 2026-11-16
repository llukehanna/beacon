/**
 * Which firms the seed leaves with an open agent run. Pure: no DB, no network. The demo should
 * open on firms whose runs show cited values, a real conflict between sources, and an honest
 * abstention, so these are the richest runs among firms nothing else in the seed has touched.
 */
import { type ScreeningRule, screenFirm } from "../../shared/activeScreening.js";
import {
  type RowCounts,
  authoritativeFinding,
  buildAxisRows,
  summarizeRows,
} from "../../shared/axisRows.js";
import { type EditMap, previewScore } from "../../shared/deskModel.js";
import { coerceFindingValue, traitOfAxis } from "../../shared/findingActions.js";
import { computeHardScreen, toQueueFirm } from "../../shared/queue.js";
import { thesisOf, traitsOf } from "../../shared/rubric/firm.js";
import type { RubricContext, ScoreResult } from "../../shared/rubric/types.js";
import { legacyTraits } from "../../shared/rubric/workspace.js";
import type { ObjectOf } from "../../shared/schema.js";
import { normalizeLifecycle } from "../../shared/vocab.js";
import { ADVISORY_ACQUISITIONS } from "../../shared/workspaces/advisoryAcquisitions.js";
import type { FindingPlan } from "../enrichment/reconcile.js";

type FirmObj = ObjectOf<"Firm">;

/** The seed's workspace, as the desk reads it. */
const RUBRIC: RubricContext = {
  definition: ADVISORY_ACQUISITIONS.rubric,
  traits: ADVISORY_ACQUISITIONS.traits,
};

/** A firm with its traits: a generated firm has only columns until the repo derives them. */
const withTraits = (firm: FirmObj): FirmObj =>
  firm.traits !== undefined ? firm : { ...firm, traits: legacyTraits(ADVISORY_ACQUISITIONS, firm) };

export const SHOWCASE_COUNT = 12;
/** At least this many CS firms are included when that many are eligible. */
const MIN_CS = 3;
/** Eligible firms must clear the hard-screen the seed approves (employees < 10). */
const MIN_EMPLOYEES = 10;

interface Ranked {
  firmId: string;
  cs: boolean;
  conflicts: number;
  providers: number;
}

function rank(firm: FirmObj, plans: readonly FindingPlan[]): Ranked | null {
  const proposed = plans.some((p) => p.findingStatus === "proposed" && p.sourceQuote);
  const abstained = plans.some((p) => p.findingStatus === "abstained");
  if (!proposed || !abstained) {
    return null;
  }
  return {
    firmId: firm.$primaryKey,
    cs: (firm.firmType ?? "").toLowerCase() === "cs",
    conflicts: new Set(plans.flatMap((p) => (p.conflictGroupId ? [p.conflictGroupId] : []))).size,
    providers: new Set(plans.filter((p) => p.sourceQuote).flatMap((p) => p.provider.split("+")))
      .size,
  };
}

/**
 * The firm ids to show, richest first. Eligible firms are still in the queue (Discovered, not yet
 * enriched, large enough to clear the employees screen) and have both a value to review and an
 * abstention. Rank is conflict groups, then distinct cited providers, then firm id; the result
 * holds at least `MIN_CS` CS firms when that many are eligible. A firm the desk's queue would
 * hard-screen under `rules` (the shared verdict the queue ranks with) is never picked, so every
 * showcase firm stays in the live queue.
 */
export function pickShowcaseFirms(
  candidates: readonly FirmObj[],
  plansFor: (firm: FirmObj) => FindingPlan[],
  n: number = SHOWCASE_COUNT,
  rules: readonly ScreeningRule[] = [],
): string[] {
  const ranked = candidates
    .filter(
      (f) =>
        normalizeLifecycle(f.lifecycleState) === "Discovered" &&
        f.enrichedBy == null &&
        Number(traitsOf(withTraits(f)).employees ?? 0) >= MIN_EMPLOYEES &&
        !isScreened(f, rules),
    )
    .flatMap((f) => rank(f, plansFor(f)) ?? [])
    .sort(
      (a, b) => b.conflicts - a.conflicts || b.providers - a.providers || cmp(a.firmId, b.firmId),
    );
  const chosen = ranked.slice(0, n);
  const need = Math.min(MIN_CS, n) - chosen.filter((r) => r.cs).length;
  if (need > 0) {
    const extra = ranked
      .slice(n)
      .filter((r) => r.cs)
      .slice(0, need);
    // Make room by dropping the lowest-ranked non-CS firms.
    const keep = new Set(chosen.filter((r) => r.cs));
    const others = chosen.filter((r) => !r.cs).slice(0, Math.max(0, n - keep.size - extra.length));
    const final = [...keep, ...extra, ...others];
    return ranked.filter((r) => final.includes(r)).map((r) => r.firmId);
  }
  return chosen.map((r) => r.firmId);
}

/** The desk's verdicts: the queue's hard-screen (base rules and approved rules) and its sidebar screen. */
export function isScreened(firm: FirmObj, rules: readonly ScreeningRule[]): boolean {
  const f = withTraits(firm);
  return (
    computeHardScreen(RUBRIC, toQueueFirm(f), rules).hardScreened ||
    screenFirm(RUBRIC, f, rules).screened
  );
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * How a firm's open agent run reads on the Desk: the grid's counts, the score if every proposed
 * value were verified (the Desk's projection: conflicts and abstentions left out), and the gates a
 * proposed value would fail. Used to check that the strong showcase firms still deserve the name.
 */
export function runProfile(
  firm: FirmObj,
  findings: readonly ObjectOf<"ResearchFinding">[],
): RowCounts & { projected: ScoreResult; failingGates: string[] } {
  const f0 = withTraits(firm);
  const rows = buildAxisRows(
    RUBRIC,
    thesisOf(f0),
    undefined,
    findings.filter((f) => f.firmId === firm.$primaryKey),
  );
  const proposed: EditMap = {};
  const failingGates: string[] = [];
  for (const row of rows) {
    const f = row.state === "proposed" ? authoritativeFinding(row) : undefined;
    const trait = traitOfAxis(RUBRIC, row.axis);
    const value =
      f === undefined || trait === undefined
        ? undefined
        : coerceFindingValue(RUBRIC, trait.traitKey, f.value);
    if (trait === undefined || value === undefined) {
      continue;
    }
    proposed[trait.traitKey] = value;
    if (trait.kind === "yesno" && trait.passWhen !== null && trait.passWhen !== value) {
      failingGates.push(row.axis);
    }
  }
  return {
    ...summarizeRows(rows),
    projected: previewScore(RUBRIC, f0, proposed),
    failingGates,
  };
}
