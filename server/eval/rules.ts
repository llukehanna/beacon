/**
 * Rule recovery: plant the seed's rejection patterns in memory, run the clusterer over them, and
 * count how many planted patterns come back as proposals. Pure: no DB, no network, and no Claude
 * call; the default clusterer is the deterministic heuristic.
 */
import type { EvalReport } from "../../shared/evalReport.js";
import type { ObjectOf } from "../../shared/schema.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer, RejectionRow } from "../clustering/types.js";
import { sortedRows } from "../db/ordering.js";
import { rng } from "../enrichment/random.js";
import {
  DEAL_VOLUME_RATIONALE,
  GENERALIST_RATIONALE,
  MISC_RATIONALE,
  REJECTION_COUNTS,
  dealSizeRationale,
  plantedDealSize,
  plantedDealVolume,
  smallFirmRationale,
} from "../seed/rejections.js";

export interface PlantedPattern {
  predicate: { axis: string; operator: string; threshold: string };
  /** The rejections the analyst made for this reason. */
  decisionIds: string[];
}

type FirmObj = ObjectOf<"Firm">;

const generalist = (f: FirmObj): boolean => /generalist/i.test(f.coverageModel ?? "");

/**
 * The rejections the seed makes, taken from the generated universe by the seed's own selection
 * rules, plus the noise rejections ("weak MD experience") that no hard-screen rule can express.
 */
export function plantRejections(universe: readonly FirmObj[]): {
  rows: RejectionRow[];
  planted: PlantedPattern[];
} {
  const r = rng("beacon-eval-rule-recovery");
  const taken = new Set<string>();
  const rows: RejectionRow[] = [];
  const pool = () =>
    sortedRows("Firm", universe, ["firmName"]).filter(
      (f) => !taken.has(f.$primaryKey) && (f.firmType ?? "CF") === "CF",
    );
  const reject = (firm: FirmObj, rationale: string, facts: Partial<FirmObj> = {}): string => {
    taken.add(firm.$primaryKey);
    const decisionId = `eval-rejection-${String(rows.length + 1).padStart(3, "0")}`;
    rows.push({
      decisionId,
      firmId: firm.$primaryKey,
      rationale,
      firm: { ...firm, ...facts },
    });
    return decisionId;
  };

  const small = pool()
    .filter((f) => (f.employees ?? 99) < 10)
    .slice(0, REJECTION_COUNTS.small)
    .map((f) => reject(f, smallFirmRationale(f.employees)));
  const generalists = pool()
    .filter(generalist)
    .slice(0, REJECTION_COUNTS.generalist)
    .map((f) => reject(f, GENERALIST_RATIONALE));
  const smallDeals = pool()
    .filter((f) => f.dealSizeMUsd === undefined && (f.employees ?? 0) >= 10 && !generalist(f))
    .slice(0, REJECTION_COUNTS.dealSize)
    .map((f) => {
      const size = plantedDealSize(r);
      return reject(f, dealSizeRationale(size), { dealSizeMUsd: size });
    });
  const lowVolume = pool()
    .filter((f) => f.dealsPerMdL3y === undefined && (f.employees ?? 0) >= 10 && !generalist(f))
    .slice(0, REJECTION_COUNTS.dealVolume)
    .map((f) => reject(f, DEAL_VOLUME_RATIONALE, { dealsPerMdL3y: plantedDealVolume(r) }));
  pool()
    .filter((f) => (f.employees ?? 0) >= 10 && !generalist(f))
    .slice(0, REJECTION_COUNTS.misc)
    .forEach((f) => reject(f, MISC_RATIONALE));

  const planted: PlantedPattern[] = [
    { predicate: { axis: "employees", operator: "<", threshold: "10" }, decisionIds: small },
    {
      predicate: { axis: "coverage_model", operator: "==", threshold: "Generalist" },
      decisionIds: generalists,
    },
    {
      predicate: { axis: "deal_size_usd_m", operator: "<", threshold: "30" },
      decisionIds: smallDeals,
    },
    {
      predicate: { axis: "deals_per_md_l3y", operator: "<", threshold: "2" },
      decisionIds: lowVolume,
    },
  ];
  return { rows, planted: planted.filter((p) => p.decisionIds.length > 0) };
}

/**
 * A planted pattern is recovered when the clusterer proposes its rule (same axis, operator and
 * threshold) and every rejection made for that reason supports the proposal.
 */
export async function evaluateRuleRecovery(
  universe: readonly FirmObj[],
  clusterer: Clusterer = heuristicClusterer,
): Promise<EvalReport["ruleRecovery"]> {
  const { rows, planted } = plantRejections(universe);
  const { proposals } = await clusterer(rows);
  const recovered = planted.filter((p) =>
    proposals.some(
      (x) =>
        x.predicateAxis === p.predicate.axis &&
        x.ruleOperator === p.predicate.operator &&
        x.ruleThreshold === p.predicate.threshold &&
        p.decisionIds.every((id) => x.supportingDecisionIds.includes(id)),
    ),
  );
  return { planted: planted.length, recovered: recovered.length, method: "heuristic" };
}
