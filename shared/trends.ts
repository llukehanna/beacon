/**
 * Daily rate trends for the Home metric cards.
 *
 * Pure bucketing: timestamped hit/miss events become one percentage per UTC
 * day. A day with too few events is dropped rather than plotted, and a series
 * with too few days left has no trend at all (null), so a card never shows a
 * sparkline or delta the data cannot support.
 */
import { type RatedFinding, classify } from "./trustMetrics.js";
import { ANALYST } from "./vocab.js";

export interface TrendPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  /** Percent of the day's events that were hits, 0-100. */
  value: number;
  /** Events behind the value. */
  n: number;
}

export interface Trend {
  points: TrendPoint[];
  /** round(last.value - first.value) in percentage points; null with fewer than two points. */
  delta: number | null;
}

export interface TrendEvent {
  at: string;
  hit: boolean;
}

export interface TrendOptions {
  /** Days that must survive thinning for a trend to exist. Default 4. */
  minBuckets?: number;
  /** Events a day needs to be kept. Default 5. */
  minPerBucket?: number;
}

export const MIN_TREND_BUCKETS = 4;
export const MIN_TREND_PER_BUCKET = 5;

export function dailyRateTrend(
  events: readonly TrendEvent[],
  opts: TrendOptions = {},
): Trend | null {
  const minBuckets = opts.minBuckets ?? MIN_TREND_BUCKETS;
  const minPerBucket = opts.minPerBucket ?? MIN_TREND_PER_BUCKET;
  const days = new Map<string, { hits: number; n: number }>();
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t)) {
      continue;
    }
    const day = new Date(t).toISOString().slice(0, 10);
    const bucket = days.get(day) ?? { hits: 0, n: 0 };
    bucket.n += 1;
    bucket.hits += e.hit ? 1 : 0;
    days.set(day, bucket);
  }
  const points: TrendPoint[] = [...days.entries()]
    .filter(([, b]) => b.n >= minPerBucket)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, b]) => ({ day, value: Math.round((b.hits / b.n) * 100), n: b.n }));
  if (points.length < Math.max(1, minBuckets)) {
    return null;
  }
  const delta =
    points.length < 2 ? null : Math.round(points[points.length - 1].value - points[0].value);
  return { points, delta };
}

// ─── Finding-backed trends ──────────────────────────────────────────────

/** The finding columns the three Home trends read. */
export interface TrendFinding extends RatedFinding {
  sourceQuote?: string | null;
  retrievedAt?: string | null;
  verifiedAt?: string | null;
}

/** Values an agent source produced, and how many of them carry a source quote. */
export interface GroundedCounts {
  cited: number;
  agentValues: number;
}

/**
 * An agent-produced value: not an abstention (nothing to ground) and not an analyst's own entry
 * (no source by design). The denominator of both the grounded trend and the grounded count.
 */
function isAgentValue(f: TrendFinding): boolean {
  return classify(f) !== "abstain" && (f.provider ?? "").trim().toLowerCase() !== ANALYST;
}

const isCited = (f: TrendFinding) => (f.sourceQuote ?? "").trim() !== "";

/** The grounded card's "X of Y": the counts behind the grounded trend's definition, over all findings. */
export function groundedCounts(findings: readonly TrendFinding[]): GroundedCounts {
  const values = findings.filter(isAgentValue);
  return { cited: values.filter(isCited).length, agentValues: values.length };
}

export interface FindingTrends {
  grounded: Trend | null;
  abstention: Trend | null;
  agreement: Trend | null;
}

/**
 * - grounded: of the values an agent source produced (abstentions have nothing
 *   to ground; an analyst's own entry has no source by design), the share
 *   carrying a source quote, by `retrievedAt`.
 * - abstention: of all findings, the share that abstained, by `retrievedAt`
 *   (the same denominator as the Accuracy page's rate).
 * - agreement: of the analyst-decided findings, the share agreed with, by
 *   `verifiedAt` (the same `classify` the Accuracy page uses).
 */
export function findingTrends(
  findings: readonly TrendFinding[],
  opts?: TrendOptions,
): FindingTrends {
  const grounded: TrendEvent[] = [];
  const abstention: TrendEvent[] = [];
  const agreement: TrendEvent[] = [];
  for (const f of findings) {
    const cls = classify(f);
    if (f.retrievedAt) {
      abstention.push({ at: f.retrievedAt, hit: cls === "abstain" });
      if (isAgentValue(f)) {
        grounded.push({ at: f.retrievedAt, hit: isCited(f) });
      }
    }
    if (f.verifiedAt && (cls === "agree" || cls === "override")) {
      agreement.push({ at: f.verifiedAt, hit: cls === "agree" });
    }
  }
  return {
    grounded: dailyRateTrend(grounded, opts),
    abstention: dailyRateTrend(abstention, opts),
    agreement: dailyRateTrend(agreement, opts),
  };
}
