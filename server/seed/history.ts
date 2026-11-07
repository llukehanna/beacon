/**
 * A few weeks of plausible analyst work, produced by the real action
 * handlers on an advancing clock: mandates and searches, agent enrichment
 * with verifications, overrides and conflict resolutions, qualifications,
 * clustered rejections, an approved rule, outcomes, and open drift. It ends with a few firms
 * whose agent runs are left open for the analyst.
 */
import { toScreeningRules } from "../../shared/activeScreening.js";
import type { ActionName, ObjectOf, ObjectTypeName } from "../../shared/schema.js";
import { parseAxisValue, scoreFirm } from "../../shared/scoring.js";
import { USER, axisByName } from "../../shared/vocab.js";
import { NO_WALL } from "../access.js";
import { type ApplyOptions, applyAction } from "../actions/apply.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db } from "../db/client.js";
import { sortedRows } from "../db/ordering.js";
import { getObject, listAll } from "../db/repo.js";
import { truthFor } from "../enrichment/providers.js";
import { rng } from "../enrichment/random.js";
import { sameValue } from "../enrichment/reconcile.js";
import { planFirmAxes } from "../extraction/plan.js";
import { planRejections } from "./rejections.js";
import { pickShowcaseFirms } from "./showcase.js";

type FirmObj = ObjectOf<"Firm">;

export const SEED_MANDATES = [
  {
    title: "Sector-focused sell-side M&A boutiques in North America",
    archetype: "CF",
    geographies: ["Americas"],
    priority: "High",
  },
  {
    title: "European mid-market advisory with cross-border reach",
    archetype: "CF",
    geographies: ["Europe"],
    priority: "Medium",
  },
  {
    title: "Private credit advisory specialists",
    archetype: "CS",
    geographies: [],
    priority: "Medium",
  },
];

const STRONG_VALUES = {
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  dealSizeMUsd: 180,
  dealsPerMdL3y: 5.2,
  firmAge: 15,
  feeGeneratingCount: 5,
};

/**
 * Ids the seed gives its records: the same on every run, so a recording made against one seed
 * (the clustering fixture names decisions by id) still matches the next.
 */
function seedIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-seed-${String(++n).padStart(5, "0")}`;
}

/**
 * Every object of a type in a fixed, collation-independent order (see `sortedRows`): which firms
 * the seed picks, and so the rejections a recorded clustering reply is matched against, must not
 * depend on the database's text ordering.
 */
async function all<N extends ObjectTypeName>(
  db: Db,
  type: N,
  opts: { where?: Record<string, { $eq: string }>; orderBy?: readonly string[] } = {},
): Promise<ObjectOf<N>[]> {
  return sortedRows(type, await listAll(db, type, { where: opts.where }), opts.orderBy);
}

export async function seedHistory(
  db: Db,
  start: Date,
  opts: Pick<ApplyOptions, "newId"> & { clusterer?: Clusterer } = {},
): Promise<void> {
  const newId = opts.newId ?? seedIds();
  const clusterer = opts.clusterer ?? heuristicClusterer;
  const r = rng("beacon-history-v1");
  let clock = start.getTime();
  const act = (name: ActionName, params: Record<string, unknown>) => {
    clock += (10 + Math.floor(r() * 40)) * 60_000;
    return applyAction(db, name, params, {
      now: new Date(clock),
      clusterer,
      newId,
      // The seeded history is demo data, not a measurement of the running app, and no persona builds it.
      recordRun: null,
      access: NO_WALL,
    });
  };
  const at = () => new Date(clock).toISOString();
  const loadFirm = async (id: string): Promise<FirmObj> => (await getObject(db, "Firm", id))!;

  async function enrichLikeAnAnalyst(id: string): Promise<void> {
    await act("runAgentEnrichment", { firm: id });
    const firm = await loadFirm(id);
    const open = (await all(db, "ResearchFinding", { where: { firmId: { $eq: id } } })).filter(
      (f) => f.findingStatus === "proposed" || f.findingStatus === "abstained",
    );
    const accepted: Record<string, unknown> = {};
    const manual: string[] = [];
    const overridden: string[] = [];

    const conflicts = new Map<string, typeof open>();
    for (const f of open) {
      if (f.conflictGroupId) {
        conflicts.set(f.conflictGroupId, [...(conflicts.get(f.conflictGroupId) ?? []), f]);
      }
    }
    for (const pair of conflicts.values()) {
      if (pair.length < 2) {
        continue;
      }
      const axis = axisByName(pair[0].axis!)!;
      const truth = truthFor(firm, axis);
      const right = pair.find((f) => sameValue(axis, f.value ?? "", truth)) ?? pair[0];
      const wrong = pair.find((f) => f !== right)!;
      await act("resolveConflict", {
        chosenFinding: right.$primaryKey,
        rejectedFinding: wrong.$primaryKey,
        chosenValue: right.value,
      });
      accepted[axis.actionParam] = parseAxisValue(axis, right.value!);
    }

    for (const f of open.filter((x) => !x.conflictGroupId)) {
      const axis = axisByName(f.axis!)!;
      const truth = truthFor(firm, axis);
      if (f.findingStatus === "abstained") {
        if (r() < 0.6) {
          await act("verifyFinding", { finding: f.$primaryKey, overrideValue: truth });
          accepted[axis.actionParam] = parseAxisValue(axis, truth);
          manual.push(axis.actionParam);
        }
        continue;
      }
      if (r() < 0.15) {
        continue;
      } // left for the analyst: keeps real work on the desk
      if (sameValue(axis, f.value!, truth)) {
        await act("verifyFinding", { finding: f.$primaryKey });
      } else {
        await act("verifyFinding", { finding: f.$primaryKey, overrideValue: truth });
        overridden.push(axis.actionParam);
      }
      accepted[axis.actionParam] = parseAxisValue(axis, truth);
    }
    if (Object.keys(accepted).length > 0) {
      await act("enrichFirm", {
        firm: id,
        ...accepted,
        fieldsEnteredManually: JSON.stringify(manual),
        agentValuesOverridden: JSON.stringify(overridden),
      });
    }
  }

  // 1. Mandates and searches.
  for (const m of SEED_MANDATES) {
    await act("runMandateSearch", m);
  }
  const mandates = await all(db, "Mandate", { orderBy: ["createdAt"] });
  await act("runSearch", {
    mandate: mandates[0].$primaryKey,
    geographies: ["United States", "Canada"],
    industries: ["Corporate Finance", "Technology", "Healthcare"],
    breadth: "broad",
  });
  await act("runSearch", {
    mandate: mandates[1].$primaryKey,
    geographies: ["Europe"],
    industries: ["Corporate Finance"],
    breadth: "standard",
  });

  // 2. Enrich the searched firms plus a few CS firms.
  const members = (await all(db, "SearchMembership")).map((m) => m.firmId);
  const csFirms = (
    await all(db, "Firm", {
      where: { firmType: { $eq: "CS" } },
      orderBy: ["firmName"],
    })
  )
    .slice(0, 10)
    .map((f) => f.$primaryKey);
  const cohort = [...new Set([...members, ...csFirms])].slice(0, 60);
  for (const id of cohort) {
    await enrichLikeAnAnalyst(id);
  }

  // 3. Qualify the strongest; move a few through the pipeline.
  const ranked = (await all(db, "Firm"))
    .filter((f) => f.enrichedBy === USER)
    .map((f) => ({ f, s: scoreFirm(f) }))
    .sort((a, b) => b.s.weightedTotal - a.s.weightedTotal);
  const qualified = ranked
    .filter((x) => !x.s.hardRejected && (x.s.tier === "A" || x.s.tier === "B"))
    .slice(0, 8)
    .map((x) => x.f.$primaryKey);
  for (const id of qualified) {
    await act("qualifyFirm", { firm: id });
  }
  // Deals in flight: the strongest qualified firms, one at each later stage
  // (Outreach, NDA, IOI, LOI, Closed).
  const DEAL_STAGES = ["Outreach", "NDA", "IOI", "LOI", "Closed"];
  for (const [i, firm] of qualified.slice(0, DEAL_STAGES.length).entries()) {
    for (const targetState of DEAL_STAGES.slice(0, i + 1)) {
      await act("advanceStage", { firm, targetState });
    }
  }

  // 4. Rejections that form clusters the learning loop can find.
  const { noise: misc } = await planRejections(
    {
      firms: () => all(db, "Firm", { orderBy: ["firmName"] }),
      record: async (firm, facts) => {
        await act("enrichFirm", {
          firm: firm.$primaryKey,
          ...facts,
          fieldsEnteredManually: JSON.stringify(Object.keys(facts)),
        });
      },
      reject: async (firm, why) => {
        await act("rejectFirm", { firm: firm.$primaryKey, rejectionRationale: why });
      },
      draw: r,
    },
    new Set(qualified),
  );

  // 5. Learn from the rejections; approve the clearest rule: the employees rule, or else the one
  // with the most supporting firms (a recorded Claude reply need not propose employees).
  await act("clusterRejections", {});
  const proposals = await all(db, "ProposedRule");
  const clearest =
    proposals.find((x) => x.predicateAxis === "employees") ??
    proposals.reduce<(typeof proposals)[number] | undefined>(
      (best, x) =>
        best === undefined || (x.supportingFirmCount ?? 0) > (best.supportingFirmCount ?? 0)
          ? x
          : best,
      undefined,
    );
  if (clearest) {
    await act("approveRule", { proposedRule: clearest.$primaryKey });
  }

  // 6. Observed outcomes.
  // One per deal stage, in DEAL_STAGES order, and none ahead of the firm's stage:
  // Outreach went quiet, NDA and IOI are in talks, LOI has an LOI, Closed closed.
  const outcomes = ["went_cold", "converted_to_talks", "converted_to_talks", "loi", "closed"];
  for (const [i, id] of qualified.slice(0, DEAL_STAGES.length).entries()) {
    await act("setFirmOutcome", { firm: id, outcome: outcomes[i], outcomeObservedAt: at() });
  }
  const earliestRejected = (
    await all(db, "ReviewDecision", {
      where: { decisionType: { $eq: "reject" } },
      orderBy: ["decidedAt"],
    })
  )
    .slice(0, 2)
    .map((d) => d.firmId!);
  if (earliestRejected[0]) {
    await act("setFirmOutcome", {
      firm: earliestRejected[0],
      outcome: "acquired_by_competitor",
      outcomeObservedAt: at(),
    });
  }
  if (earliestRejected[1]) {
    await act("setFirmOutcome", {
      firm: earliestRejected[1],
      outcome: "went_cold",
      outcomeObservedAt: at(),
    });
  }

  // 7. New evidence moves terminal firms: open drift for the Review page.
  for (const id of qualified.slice(4, 8)) {
    await act("enrichFirm", {
      firm: id,
      dealSizeMUsd: 12,
      dealsPerMdL3y: 0.8,
      firmAge: 2,
      fieldsEnteredManually: JSON.stringify(["dealSizeMUsd", "dealsPerMdL3y", "firmAge"]),
    });
  }
  if (misc[0]) {
    await act("enrichFirm", {
      firm: misc[0].$primaryKey,
      ...STRONG_VALUES,
      fieldsEnteredManually: JSON.stringify(Object.keys(STRONG_VALUES)),
    });
  }

  // 8. One resolved drift so the history shows both states. Every kind of drift stays open
  // once: the outcome_diverged event is left for the analyst, and the resolved one is a
  // tier_moved firm that is still in the pipeline.
  const tierDrift = (
    await all(db, "DriftEvent", { where: { driftReason: { $eq: "tier_moved" } } })
  )[0];
  if (tierDrift) {
    await act("acknowledgeDrift", {
      driftEvent: tierDrift.$primaryKey,
      note: "The new evidence is thin; we are keeping the firm in the pipeline for now.",
    });
  }

  // 9. Showcase: the agent runs the demo opens on, left open. The picker skips firms an earlier
  // step touched, and firms the desk's own queue would hard-screen under the approved rules
  // (base rules included), so all stay in the live queue.
  const rules = toScreeningRules(
    (await all(db, "ProposedRule")).map((p) => ({ ...p, proposedRuleId: p.$primaryKey })),
    await all(db, "HardScreenConfig"),
  );
  const candidates = await all(db, "Firm");
  const stored = new Map<string, ObjectOf<"Extraction">[]>();
  for (const row of await all(db, "Extraction")) {
    stored.set(row.firmId ?? "", [...(stored.get(row.firmId ?? "") ?? []), row]);
  }
  // Only previews the plans, so these ids are never stored.
  const plansFor = (firm: FirmObj) => {
    let n = 0;
    return planFirmAxes(firm, stored.get(firm.$primaryKey) ?? [], () => `preview-${++n}`).flatMap(
      (a) => a.plans,
    );
  };
  for (const id of pickShowcaseFirms(candidates, plansFor, undefined, rules)) {
    await act("runAgentEnrichment", { firm: id });
  }
}
