/**
 * Everything the Home page shows, computed on the server so the client
 * receives a few kilobytes instead of every firm, finding and drift row.
 *
 * Each number follows the rule Home.tsx used to apply client-side; the pure
 * pieces of those rules (queue ranking, funnel buckets, rule projection,
 * trust rates) live in shared/ and are called here unchanged. Counting that
 * is plain row selection (findings, mandate scope) runs as SQL aggregates.
 */
import {
  type ScreenableFirm,
  countScreened,
  isEvaluable,
  toScreeningRules,
} from "../../shared/activeScreening.js";
import { bucketOf, emptyBucketCounts } from "../../shared/pipelineBuckets.js";
import {
  type ActiveConfigRule,
  QUEUE_FIELDS,
  type QueueFirm,
  orderEnrichmentQueue,
  toQueueFirm,
} from "../../shared/queue.js";
import { summarizePredicate } from "../../shared/rulePredicate.js";
import { OBJECT_TYPES } from "../../shared/schema.js";
import { mirrorScore } from "../../shared/scoreMirror.js";
import type {
  DriftNeedsYou,
  HomeSummary,
  JudgmentNeedsYou,
  MandateSummary,
  NeedsYouDestination,
  NeedsYouItem,
  RuleNeedsYou,
} from "../../shared/summaries.js";
import { ratesFromCounts, tallyOutcomeGroups } from "../../shared/trustMetrics.js";
import type { Queryable } from "../db/client.js";
import { toWire } from "../db/repo.js";
import { findingTotals } from "./findings.js";
import { outcomeGroups } from "./outcomes.js";

/** Rows in the Home inbox before "+N more". */
export const VISIBLE_ROWS = 7;

type FirmRow = QueueFirm & ScreenableFirm;

export async function loadLeanFirms(q: Queryable): Promise<FirmRow[]> {
  const rows = await q.query(
    `SELECT ${QUEUE_FIELDS.map((c) => `"${c}"`).join(", ")} FROM ${OBJECT_TYPES.Firm.table}`,
  );
  return rows.map((r) => toWire("Firm", r)) as unknown as FirmRow[];
}

async function loadActiveConfigs(q: Queryable): Promise<ActiveConfigRule[]> {
  const rows = await q.query<{
    configRuleId: string;
    configAxis: string | null;
    configOperator: string | null;
    configThreshold: string | null;
    configModel: string | null;
  }>(
    `SELECT "configRuleId", "configAxis", "configOperator", "configThreshold", "configModel"
       FROM hard_screen_config WHERE "configActive" = true ORDER BY "configRuleId"`,
  );
  return rows
    .map((r) => ({
      ruleId: r.configRuleId,
      axis: r.configAxis ?? "",
      operator: r.configOperator ?? "",
      threshold: r.configThreshold ?? "",
      model: r.configModel ?? "both",
    }))
    .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "");
}

/**
 * Axes per firm whose authoritative finding abstained ("no source had it").
 * shared/axisState.needsYouAxisCountByFirm is the reference: superseded and
 * conflict-grouped findings are invisible, one authoritative finding per
 * (firm, axis) — human-verified first, else latest retrievedAt — decides.
 */
export async function needsYouAxes(q: Queryable): Promise<Map<string, number>> {
  const rows = await q.query<{ firmId: string; axes: number }>(
    `WITH visible AS (
       SELECT "firmId", coalesce("axis", '') AS axis, "findingId", "retrievedAt",
              (coalesce("verifiedByHuman", false) OR lower(coalesce("findingStatus", '')) = 'verified') AS verified,
              (lower(coalesce("confidenceTier", '')) = 'abstain' OR lower(coalesce("findingStatus", '')) = 'abstained') AS abstained
         FROM research_finding
        WHERE coalesce("firmId", '') <> ''
          AND lower(coalesce("findingStatus", '')) <> 'superseded'
          AND coalesce("conflictGroupId", '') = ''
     ), authoritative AS (
       SELECT DISTINCT ON ("firmId", axis) "firmId", verified, abstained
         FROM visible
        ORDER BY "firmId", axis, verified DESC, "retrievedAt" DESC NULLS LAST, "findingId" ASC
     )
     SELECT "firmId", count(*)::int AS axes FROM authoritative
      WHERE abstained AND NOT verified GROUP BY "firmId"`,
  );
  return new Map(rows.map((r) => [r.firmId, r.axes]));
}

/** Open drift events, newest first (the order /review lists them). */
async function openDrifts(q: Queryable) {
  return q.query<{
    driftEventId: string;
    firmId: string | null;
    driftReason: string | null;
    priorTier: string | null;
    priorScore: number | null;
    newTier: string | null;
    newScore: number | null;
  }>(
    `SELECT "driftEventId", "firmId", "driftReason", "priorTier", "priorScore", "newTier", "newScore"
       FROM drift_event
      WHERE lower(coalesce("driftStatus", '')) <> 'resolved'
      ORDER BY "detectedAt" DESC NULLS LAST, "driftEventId" ASC`,
  );
}

export async function pendingRules(q: Queryable) {
  return q.query<PendingRule>(
    `SELECT "proposedRuleId", "predicateAxis", "ruleOperator", "ruleThreshold", "ruleModel"
       FROM proposed_rule
      WHERE lower(coalesce("ruleStatus", 'pending')) = 'pending'
      ORDER BY "proposedRuleId"`,
  );
}

const orUndefined = <T>(v: T | null): T | undefined => v ?? undefined;

interface PendingRule {
  proposedRuleId: string;
  predicateAxis: string | null;
  ruleOperator: string | null;
  ruleThreshold: string | null;
  ruleModel: string | null;
}

/**
 * How many firms a pending rule WOULD screen if approved; null when the
 * predicate isn't numerically evaluable (a text predicate is not "screens
 * nobody"). Computed only for the rule rows that will be shown.
 */
export function projectRule(r: PendingRule, firms: readonly ScreenableFirm[]): number | null {
  const [rule] = toScreeningRules(
    [
      {
        proposedRuleId: r.proposedRuleId,
        ruleStatus: "approved", // count what it WOULD screen
        predicateAxis: orUndefined(r.predicateAxis),
        ruleOperator: orUndefined(r.ruleOperator),
        ruleThreshold: orUndefined(r.ruleThreshold),
        ruleModel: orUndefined(r.ruleModel),
      },
    ],
    [],
  );
  return rule === undefined || !isEvaluable(rule) ? null : countScreened(firms, [rule]);
}

/**
 * Firms a mandate has scoped: SearchList ∪ SearchMembership ∪ discoveredVia,
 * and the searches' own share of that. shared/mandateFirms.mandateFirmCounts
 * is the reference for the rules.
 */
async function mandateCounts(
  q: Queryable,
): Promise<Map<string, { scoped: number; fromSearches: number }>> {
  const rows = await q.query<{ mid: string; scoped: number; fromSearches: number }>(
    `WITH ms AS (
       SELECT "searchId" AS sid, btrim("mandateId") AS mid FROM search
        WHERE btrim(coalesce("mandateId", '')) <> ''
       UNION ALL
       SELECT sl."searchId", btrim(sl."mandateId") FROM search_list sl
        WHERE btrim(coalesce(sl."mandateId", '')) <> ''
          AND sl."searchId" NOT IN (SELECT "searchId" FROM search WHERE btrim(coalesce("mandateId", '')) <> '')
     ), from_searches AS (
       SELECT ms.mid, btrim(m."firmId") AS fid FROM search_membership m
         JOIN ms ON ms.sid = btrim(coalesce(m."searchId", ''))
        WHERE btrim(coalesce(m."firmId", '')) <> ''
       UNION
       SELECT ms.mid, btrim(f."firmId") FROM firm f
         JOIN ms ON ms.sid = btrim(coalesce(f."discoveredViaSearchId", ''))
        WHERE btrim(coalesce(f."firmId", '')) <> ''
     ), from_lists AS (
       SELECT btrim(sl."mandateId") AS mid, btrim(f."firmId") AS fid FROM search_list sl
         JOIN search_list_firm lf ON lf."searchId" = sl."searchId"
         JOIN firm f ON f."firmId" = lf."firmId"
        WHERE btrim(coalesce(sl."mandateId", '')) <> '' AND btrim(coalesce(f."firmId", '')) <> ''
     ), scoped AS (
       SELECT mid, fid FROM from_searches UNION SELECT mid, fid FROM from_lists
     )
     SELECT s.mid, s.n AS scoped, coalesce(fs.n, 0) AS "fromSearches"
       FROM (SELECT mid, count(*)::int AS n FROM scoped GROUP BY mid) s
       LEFT JOIN (SELECT mid, count(*)::int AS n FROM from_searches GROUP BY mid) fs ON fs.mid = s.mid`,
  );
  return new Map(rows.map((r) => [r.mid, { scoped: r.scoped, fromSearches: r.fromSearches }]));
}

async function activeMandates(q: Queryable): Promise<MandateSummary[]> {
  const [mandates, counts] = await Promise.all([
    q.query<{
      mandateId: string;
      title: string | null;
      intentStatement: string | null;
      archetype: string | null;
      priority: string | null;
    }>(
      // active === false retires a mandate; null predates the flag and still counts.
      `SELECT "mandateId", "title", "intentStatement", "archetype", "priority" FROM mandate
        WHERE "active" IS DISTINCT FROM false
        ORDER BY "createdAt" DESC NULLS LAST, "mandateId" ASC`,
    ),
    mandateCounts(q),
  ]);
  return mandates.map((m) => ({
    mandateId: m.mandateId,
    title: orUndefined(m.title),
    intentStatement: orUndefined(m.intentStatement),
    archetype: orUndefined(m.archetype),
    priority: orUndefined(m.priority),
    scoped: counts.get(m.mandateId)?.scoped ?? 0,
    fromSearches: counts.get(m.mandateId)?.fromSearches ?? 0,
  }));
}

export async function homeSummary(q: Queryable): Promise<HomeSummary> {
  const [firms, configs, axesByFirm, drifts, rules, mandates, totals, groups] = await Promise.all([
    loadLeanFirms(q),
    loadActiveConfigs(q),
    needsYouAxes(q),
    openDrifts(q),
    pendingRules(q),
    activeMandates(q),
    findingTotals(q),
    outcomeGroups(q),
  ]);

  // Funnel: one bucket per firm, hard-reject verdict included.
  const funnel = emptyBucketCounts();
  for (const f of firms) {
    funnel[bucketOf(f, mirrorScore(f))] += 1;
  }

  // Judgment rows: firms in the desk's workable band with an abstained axis,
  // in the desk's queue order. Ranking only these keeps the order the full
  // sort would give them (the comparator is a total order).
  const firmById = new Map(firms.map((f) => [f.firmId, f]));
  const judgmentFirms: JudgmentNeedsYou[] = orderEnrichmentQueue(
    firms.filter((f) => axesByFirm.has(f.firmId)).map(toQueueFirm),
    configs,
  )
    .filter((r) => !r.hardScreened && !r.terminal)
    .map((r) => ({
      kind: "judgment",
      key: `firm:${r.firm.firmId}`,
      rank: 3,
      destination: "desk",
      firmId: r.firm.firmId,
      name: r.firm.firmName ?? r.firm.firmId,
      axes: axesByFirm.get(r.firm.firmId) ?? 0,
    }));

  const driftItems: DriftNeedsYou[] = drifts.map((d) => {
    const reason = (d.driftReason ?? "").toLowerCase();
    const firm = d.firmId === null ? undefined : firmById.get(d.firmId);
    return {
      kind: "drift",
      key: `drift:${d.driftEventId}`,
      rank: reason === "outcome_diverged" ? 0 : reason === "pass_reason_invalidated" ? 1 : 2,
      destination: "review",
      firmId: orUndefined(d.firmId),
      name: firm ? (firm.firmName ?? firm.firmId) : (d.firmId ?? "Unknown firm"),
      driftReason: orUndefined(d.driftReason),
      priorTier: orUndefined(d.priorTier),
      priorScore: orUndefined(d.priorScore),
      newTier: orUndefined(d.newTier),
      newScore: orUndefined(d.newScore),
    };
  });

  const ruleItems = (): RuleNeedsYou[] =>
    rules.map((r) => ({
      kind: "rule",
      key: `rule:${r.proposedRuleId}`,
      rank: 4,
      destination: "rules",
      proposedRuleId: r.proposedRuleId,
      name:
        summarizePredicate(
          orUndefined(r.predicateAxis),
          orUndefined(r.ruleOperator),
          orUndefined(r.ruleThreshold),
        ) ?? "malformed proposal",
      screens: null,
    }));

  // Stable sort: within a rank the per-type order is already the destination page's own.
  const inbox: NeedsYouItem[] = [...driftItems, ...judgmentFirms, ...ruleItems()].sort(
    (a, b) => a.rank - b.rank,
  );
  const needsYou = inbox.slice(0, VISIBLE_ROWS);
  const pendingById = new Map(rules.map((r) => [r.proposedRuleId, r]));
  for (const item of needsYou) {
    if (item.kind === "rule") {
      item.screens = projectRule(pendingById.get(item.proposedRuleId)!, firms);
    }
  }
  const needsYouCounts: Record<NeedsYouDestination, number> = { review: 0, desk: 0, rules: 0 };
  for (const item of inbox) {
    needsYouCounts[item.destination] += 1;
  }

  const overall = ratesFromCounts(totals);
  const outcomes = tallyOutcomeGroups(groups);
  return {
    needsYou,
    needsYouTotal: inbox.length,
    needsYouCounts,
    mandates,
    funnel,
    trust: {
      abstentionRate: overall.abstention,
      agreementRate: overall.agreement,
      decidedFindings: overall.decided,
      outcomes: outcomes.counts,
      passed: outcomes.passed,
      passedAndAcquired: outcomes.passedAndAcquired,
    },
  };
}
