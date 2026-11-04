/**
 * Which firms the seed leaves with an open agent run. Pure: no DB, no network. The demo should
 * open on firms whose runs show cited values, a real conflict between sources, and an honest
 * abstention, so these are the richest runs among firms nothing else in the seed has touched.
 */
import type { ObjectOf } from "../../shared/schema.js";
import { normalizeLifecycle } from "../../shared/vocab.js";
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
 * holds at least `MIN_CS` CS firms when that many are eligible.
 */
export function pickShowcaseFirms(
  candidates: readonly FirmObj[],
  plansFor: (firm: FirmObj) => FindingPlan[],
  n: number = SHOWCASE_COUNT,
): string[] {
  const ranked = candidates
    .filter(
      (f) =>
        normalizeLifecycle(f.lifecycleState) === "Discovered" &&
        f.enrichedBy == null &&
        (f.employees ?? 0) >= MIN_EMPLOYEES,
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

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
