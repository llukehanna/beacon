/**
 * Rule recovery: plant the seed's rejection patterns in memory, run the clusterer over them, and
 * count how many planted patterns come back as proposals. The firms and their rationale come from
 * `planRejections`, the same function the seed calls. Pure: no DB, no network, and no Claude
 * call; the default clusterer is the deterministic heuristic.
 */
import type { EvalReport } from "../../shared/evalReport.js";
import type { ObjectOf } from "../../shared/schema.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer, RejectionRow } from "../clustering/types.js";
import { rng } from "../enrichment/random.js";
import { PLANTED_PREDICATES, planRejections } from "../seed/rejections.js";

export interface PlantedPattern {
  predicate: { axis: string; operator: string; threshold: string };
  /** The rejections the analyst made for this reason. */
  decisionIds: string[];
}

type FirmObj = ObjectOf<"Firm">;

/**
 * The seed's rejections over the generated universe, as the clusterer reads them, plus the
 * patterns they were planted as. Unlike the seeded history, nothing else has happened to the
 * universe first (no enrichment, no firm qualified), and the values the analyst enters come from
 * a stream of their own rather than the history's; the patterns are the seed's all the same.
 */
export async function plantRejections(universe: readonly FirmObj[]): Promise<{
  rows: RejectionRow[];
  planted: PlantedPattern[];
}> {
  const firms = new Map(universe.map((f) => [f.$primaryKey, f]));
  const rows: RejectionRow[] = [];
  const decisionOf = new Map<string, string>();
  const { patterns } = await planRejections(
    {
      firms: () => [...firms.values()],
      record: (firm, facts) => {
        firms.set(firm.$primaryKey, { ...firm, ...facts });
      },
      reject: (firm, rationale) => {
        const decisionId = `eval-rejection-${String(rows.length + 1).padStart(3, "0")}`;
        decisionOf.set(firm.$primaryKey, decisionId);
        rows.push({
          decisionId,
          firmId: firm.$primaryKey,
          rationale,
          firm: firms.get(firm.$primaryKey) ?? firm,
        });
      },
      draw: rng("beacon-eval-rule-recovery"),
    },
    new Set(),
  );
  const planted = patterns
    .map((p) => ({
      predicate: PLANTED_PREDICATES.find((x) => x.key === p.key)!,
      decisionIds: p.firmIds.map((id) => decisionOf.get(id)!),
    }))
    .filter((p) => p.decisionIds.length > 0)
    .map(({ predicate, decisionIds }) => ({
      predicate: {
        axis: predicate.axis,
        operator: predicate.operator,
        threshold: predicate.threshold,
      },
      decisionIds,
    }));
  return { rows, planted };
}

/**
 * A planted pattern is recovered when the clusterer proposes its rule (same axis, operator and
 * threshold) and every rejection made for that reason supports the proposal.
 */
export async function evaluateRuleRecovery(
  universe: readonly FirmObj[],
  clusterer: Clusterer = heuristicClusterer,
): Promise<EvalReport["ruleRecovery"]> {
  const { rows, planted } = await plantRejections(universe);
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
