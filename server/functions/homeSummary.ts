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
import {
  type ActivityFinding,
  abstainedSinceByFirm,
  buildActivity,
  latestRunHeadline,
} from "../../shared/activityFeed.js";
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
import { type TrendFinding, findingTrends, groundedCounts } from "../../shared/trends.js";
import { ratesFromCounts, tallyOutcomeGroups } from "../../shared/trustMetrics.js";
import type { Queryable } from "../db/client.js";
import { toWire } from "../db/repo.js";
import { findingTotals } from "./findings.js";
import { outcomeGroups } from "./outcomes.js";

/** Drift events that still wait on a decision (what /review lists and the Home inbox counts). */
export const OPEN_DRIFT_WHERE = `lower(coalesce("driftStatus", '')) <> 'resolved'`;

/** Active mandates: `active === false` retires one; null predates the flag and still counts. */
export const ACTIVE_MANDATE_WHERE = `"active" IS DISTINCT FROM false`;

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
    detectedAt: Date | string | null;
  }>(
    `SELECT "driftEventId", "firmId", "driftReason", "priorTier", "priorScore", "newTier", "newScore",
            "detectedAt"
       FROM drift_event
      WHERE ${OPEN_DRIFT_WHERE}
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

/** A timestamp column as the ISO string the wire carries; null stays null. */
function iso(v: Date | string | null): string | null {
  if (v === null) {
    return null;
  }
  const t = v instanceof Date ? v : new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

type FindingRow = Omit<ActivityFinding & TrendFinding, "retrievedAt" | "verifiedAt"> & {
  findingId: string;
  retrievedAt: Date | string | null;
  verifiedAt: Date | string | null;
};

/**
 * The finding columns the trends and the activity feed read: one row each, so
 * the pure modules in shared/ do the bucketing and grouping. Only whether a
 * source quote exists is needed, so its first character stands in for it.
 */
async function loadTimedFindings(q: Queryable): Promise<(ActivityFinding & TrendFinding)[]> {
  const rows = await q.query<FindingRow>(
    `SELECT "findingId", "firmId", "axis", "value", "provider", "findingStatus", "confidenceTier",
            "verifiedByHuman", "conflictGroupId", "retrievedAt", "verifiedAt",
            left(btrim(coalesce("sourceQuote", '')), 1) AS "sourceQuote"
       FROM research_finding`,
  );
  return rows.map((r) => ({
    ...r,
    retrievedAt: iso(r.retrievedAt),
    verifiedAt: iso(r.verifiedAt),
  }));
}

/** When each enriched firm was last enriched. */
async function enrichmentTimes(q: Queryable): Promise<Map<string, string>> {
  const rows = await q.query<{ firmId: string; enrichedAt: Date | string }>(
    `SELECT "firmId", "enrichedAt" FROM firm WHERE "enrichedAt" IS NOT NULL`,
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    const at = iso(r.enrichedAt);
    if (at !== null) {
      out.set(r.firmId, at);
    }
  }
  return out;
}

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
      `SELECT "mandateId", "title", "intentStatement", "archetype", "priority" FROM mandate
        WHERE ${ACTIVE_MANDATE_WHERE}
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
  const [
    firms,
    configs,
    axesByFirm,
    drifts,
    rules,
    mandates,
    totals,
    groups,
    timedFindings,
    enrichedAt,
  ] = await Promise.all([
    loadLeanFirms(q),
    loadActiveConfigs(q),
    needsYouAxes(q),
    openDrifts(q),
    pendingRules(q),
    activeMandates(q),
    findingTotals(q),
    outcomeGroups(q),
    loadTimedFindings(q),
    enrichmentTimes(q),
  ]);

  // Funnel: one bucket per firm, hard-reject verdict included.
  const funnel = emptyBucketCounts();
  for (const f of firms) {
    funnel[bucketOf(f, mirrorScore(f))] += 1;
  }

  const abstainedSince = abstainedSinceByFirm(timedFindings);

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
      at: abstainedSince.get(r.firm.firmId) ?? null,
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
      at: iso(d.detectedAt),
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
      // A proposal carries no time of its own (see the activity feed below).
      at: null,
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

  // Agent activity. A pending rule has no recorded proposal time (ProposedRule carries only
  // ruleDecidedAt), so no rule_proposed items are fed in rather than inventing one.
  const activityInput = {
    firms: firms.map((f) => ({
      firmId: f.firmId,
      firmName: f.firmName,
      enrichedAt: enrichedAt.get(f.firmId) ?? null,
    })),
    findings: timedFindings,
    driftEvents: drifts.map((d) => ({
      driftEventId: d.driftEventId,
      firmId: d.firmId,
      detectedAt: iso(d.detectedAt),
      reason: d.driftReason,
      priorTier: d.priorTier,
      newTier: d.newTier,
    })),
  };

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
    trends: findingTrends(timedFindings),
    grounded: groundedCounts(timedFindings),
    activity: buildActivity(activityInput),
    headline: latestRunHeadline(activityInput),
  };
}
