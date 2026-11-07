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
import { type EditMap, buildMerged } from "../../shared/deskModel.js";
import {
  FINDING_AXIS_TO_KEY,
  HARD_GATE_PASS_WHEN,
  coerceFindingValue,
} from "../../shared/findingActions.js";
import { computeHardScreen, toQueueFirm } from "../../shared/queue.js";
import type { ObjectOf } from "../../shared/schema.js";
import { type MirrorResult, mirrorScore } from "../../shared/scoreMirror.js";
import { scoreInputFromFirm } from "../../shared/scoring.js";
import { ENRICH_AXES, normalizeLifecycle } from "../../shared/vocab.js";
import type { FindingPlan } from "../enrichment/reconcile.js";

type FirmObj = ObjectOf<"Firm">;

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
        (f.employees ?? 0) >= MIN_EMPLOYEES &&
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
  return (
    computeHardScreen(toQueueFirm(firm), rules).hardScreened || screenFirm(firm, rules).screened
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
): RowCounts & { projected: MirrorResult; failingGates: string[] } {
  const base = scoreInputFromFirm(firm);
  const model = mirrorScore(base).model;
  const rows = buildAxisRows(
    ENRICH_AXES.filter((a) => a.models.includes(model)),
    undefined,
    findings.filter((f) => f.firmId === firm.$primaryKey),
  );
  const proposed: EditMap = {};
  const failingGates: string[] = [];
  for (const row of rows) {
    const f = row.state === "proposed" ? authoritativeFinding(row) : undefined;
    const key = FINDING_AXIS_TO_KEY[row.axis];
    const value =
      f === undefined || key === undefined ? undefined : coerceFindingValue(key, f.value);
    if (value === undefined) {
      continue;
    }
    proposed[key] = value;
    if (key in HARD_GATE_PASS_WHEN && HARD_GATE_PASS_WHEN[key] !== value) {
      failingGates.push(row.axis);
    }
  }
  return {
    ...summarizeRows(rows),
    projected: mirrorScore(buildMerged(base, proposed)),
    failingGates,
  };
}
