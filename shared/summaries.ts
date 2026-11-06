/**
 * Result shapes of the server's query functions (server/functions/). They
 * mirror Foundry query functions: the server aggregates, the client receives
 * a few kilobytes of numbers instead of every row.
 */
import type { ActivityItem, HeadlineCounts } from "./activityFeed.js";
import type { Lifecycle } from "./pipelineBuckets.js";
import type { FindingTrends, GroundedCounts } from "./trends.js";
import type { AccuracyTables, OutcomeTally, Rates } from "./trustMetrics.js";

/** Where a needs-you row sends the analyst. */
export type NeedsYouDestination = "review" | "desk" | "rules";

interface NeedsYouBase {
  key: string;
  /** Urgency: 0 divergence, 1 pass reason invalidated, 2 other drift, 3 needs-you firm, 4 pending rule. */
  rank: 0 | 1 | 2 | 3 | 4;
  destination: NeedsYouDestination;
  /** Firm name, or the rule's predicate text ("malformed proposal" when it has none). */
  name: string;
  /** ISO time the item arose (drift detected, abstention recorded); null when none was recorded. */
  at: string | null;
}

export interface DriftNeedsYou extends NeedsYouBase {
  kind: "drift";
  destination: "review";
  firmId?: string;
  driftReason?: string;
  priorTier?: string;
  priorScore?: number;
  newTier?: string;
  newScore?: number;
}

export interface JudgmentNeedsYou extends NeedsYouBase {
  kind: "judgment";
  destination: "desk";
  firmId: string;
  /** Axes whose authoritative finding abstained. */
  axes: number;
}

export interface RuleNeedsYou extends NeedsYouBase {
  kind: "rule";
  destination: "rules";
  proposedRuleId: string;
  /** Firms the rule would screen; null when the predicate can't be evaluated numerically. */
  screens: number | null;
}

export type NeedsYouItem = DriftNeedsYou | JudgmentNeedsYou | RuleNeedsYou;

export interface MandateSummary {
  mandateId: string;
  title?: string;
  intentStatement?: string;
  archetype?: string;
  priority?: string;
  /** SearchList ∪ SearchMembership ∪ discoveredVia — see shared/mandateFirms. */
  scoped: number;
  /** SearchMembership ∪ discoveredVia. */
  fromSearches: number;
}

export interface HomeSummary {
  /** The first rows of the triage inbox, most urgent first. */
  needsYou: NeedsYouItem[];
  needsYouTotal: number;
  /** Inbox rows per destination (the empty-state lines and the "+N more" target read these). */
  needsYouCounts: Record<NeedsYouDestination, number>;
  /** Active mandates, newest first. */
  mandates: MandateSummary[];
  funnel: Record<Lifecycle, number>;
  trust: {
    /** Percent; 0 when there are no findings. */
    abstentionRate: number;
    /** Percent; null until a finding has been decided. */
    agreementRate: number | null;
    decidedFindings: number;
    /** Firms per observed outcome (NULL_OUTCOME_KEY for none yet). */
    outcomes: Record<string, number>;
    passed: number;
    passedAndAcquired: number;
  };
  /**
   * Daily rate history behind the metric cards; a null entry means the data does not support
   * a trend (too few days with enough findings) and the card shows its value alone.
   */
  trends: FindingTrends;
  /** Agent-produced values and how many cite a verbatim source quote (the grounded card's X of Y). */
  grounded: GroundedCounts;
  /** Newest-first agent activity, built from existing timestamps. */
  activity: ActivityItem[];
  /** What the agent's latest runs did; null when no firm has been enriched. */
  headline: HeadlineCounts | null;
}

export interface AccuracySummary extends AccuracyTables {
  overall: Rates;
  outcomes: OutcomeTally;
}

/** The checks behind a quote: where it sits in its document and whether it supports the value. */
export interface GroundingChecks {
  /** 1-based line of the source document where the quote starts; null when it is not found. */
  line: number | null;
  valueInQuote: boolean;
  words: number;
}

/** What one provider said about one axis, and whether the quote behind it held up. */
export interface ProviderObservation {
  provider: string;
  /** The value the extraction reported; null when the provider had nothing for the axis. */
  value: string | null;
  confidence: "high" | "low" | null;
  /** True when kept, false when grounding rejected it, null when there was nothing to ground. */
  grounded: boolean | null;
  rejectReason: string | null;
  quote: string | null;
  documentId: string | null;
  checks: GroundingChecks | null;
}

/** Every provider's reading of a firm, per rubric axis (see server/functions/firmObservations). */
export interface FirmObservations {
  firmId: string;
  /** The extraction model whose output was grounded ("rule-based" when none is stored). */
  model: string;
  axes: { axis: string; providers: ProviderObservation[] }[];
  /** Per provider, how many of the firm's axes it supplied a grounded value for. */
  hitsByProvider: Record<string, number>;
}
