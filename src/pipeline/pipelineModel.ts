/**
 * What the Pipeline page shows, as plain data: the row for each firm, the stage filter and its
 * query parameter, the counts on the stage tabs and the wording of a few cells. Pure: no React,
 * no data access.
 */
import {
  type PipelineSort,
  type PipelineSortKey,
  type RejectDecision,
  pipelineSort,
} from "@/desk/pipelineRows";
import { shownScore } from "@/desk/scoreFormat";
import {
  LIFECYCLE_BUCKETS,
  type Lifecycle,
  bucketOf,
  emptyBucketCounts,
} from "../../shared/pipelineBuckets";
import { traitsOf } from "../../shared/rubric/firm";
import { showTraitValue } from "../../shared/rubric/traitValue";
import type { RubricContext, ScoreResult, TraitValue } from "../../shared/rubric/types";
import { scoreFirm } from "../../shared/scoring";
import { PASSED } from "../../shared/vocab";
import { relativeAge, toIsoTime } from "../home/age";

// ─── Rows ───────────────────────────────────────────────────────────────

export interface FirmView {
  firmId?: string;
  firmName?: string | null;
  thesis?: string | null;
  sector?: string | null;
  hqCountry?: string | null;
  lifecycleState?: string | null;
  currentStage?: string | null;
  lastReviewed?: string | number | Date | null;
  disposition?: string | null;
  // Observed post-decision outcome (FDE backfill). SDK types don't declare
  // it yet, so the reader casts at the site — accepted values include
  // converted_to_talks / loi / went_cold / acquired_by_competitor / null.
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
  outcomeSource?: string | null;
  geographicFootprint?: string | null;
  /** The firm's trait values by trait key. */
  traits?: Record<string, TraitValue>;
}

export interface LastActivity {
  type: string;
  decidedAt: unknown;
}

export interface Row {
  firm: FirmView;
  mirror: ScoreResult;
  /** Score and tier shown for the row: at-decision for passed firms, live otherwise. */
  score: { total: number; tier: string };
  bucket: Lifecycle;
  rejectionRationale: string | null;
  lastActivity: LastActivity | null;
}

/** The selected value per profile trait (trait key to value); a missing or empty entry is "any". */
export type ProfileFilter = Readonly<Record<string, string>>;

export const NO_PROFILE_FILTER: ProfileFilter = {};

export function hasProfileFilter(f: ProfileFilter): boolean {
  return Object.values(f).some((v) => v !== "");
}

const fields = (firm: FirmView): Readonly<Record<string, unknown>> =>
  firm as Readonly<Record<string, unknown>>;

/** A trait's value on a firm, by trait key. */
export function traitOn(firm: FirmView, traitKey: string): TraitValue | undefined {
  return traitsOf(fields(firm))[traitKey];
}

interface DecisionRow {
  firmId?: string | null;
  decisionType?: string | null;
  decidedAt?: unknown;
}

/**
 * The most recent decision per firm: real activity, not the default lastReviewed date. `decisions`
 * must be ordered newest first, so the first entry per firm wins.
 */
export function lastActivityByFirm(decisions: Iterable<DecisionRow>): Map<string, LastActivity> {
  const byFirm = new Map<string, LastActivity>();
  for (const d of decisions) {
    const firmId = d.firmId ?? "";
    if (firmId === "" || byFirm.has(firmId)) {
      continue;
    }
    byFirm.set(firmId, { type: (d.decisionType ?? "decision").toString(), decidedAt: d.decidedAt });
  }
  return byFirm;
}

function matchesQuery(firm: FirmView, needle: string): boolean {
  return (
    needle === "" ||
    (firm.firmName ?? "").toLowerCase().includes(needle) ||
    (firm.sector ?? "").toLowerCase().includes(needle) ||
    (firm.hqCountry ?? "").toLowerCase().includes(needle) ||
    (firm.firmId ?? "").toLowerCase().includes(needle)
  );
}

/** Every firm that passes the search box and the profile filters, scored, bucketed and sorted. */
export function buildRows(args: {
  rubric: RubricContext;
  firms: readonly FirmView[];
  query: string;
  profile: ProfileFilter;
  sort: PipelineSort;
  rejectByFirm: ReadonlyMap<string, RejectDecision>;
  activityByFirm: ReadonlyMap<string, LastActivity>;
}): Row[] {
  const { rubric, firms, query, profile, sort, rejectByFirm, activityByFirm } = args;
  const needle = query.trim().toLowerCase();
  const picked = Object.entries(profile).filter(([, v]) => v !== "");
  const built = firms
    .filter((firm) => picked.every(([key, v]) => traitOn(firm, key) === v))
    .filter((firm) => matchesQuery(firm, needle))
    .map((firm): Row => {
      const mirror = scoreFirm(rubric.definition, fields(firm));
      const bucket = bucketOf(firm, mirror);
      const reject = rejectByFirm.get(firm.firmId ?? "");
      return {
        firm,
        mirror,
        score: shownScore(mirror, bucket === PASSED, reject),
        bucket,
        rejectionRationale: reject?.rationale ?? null,
        lastActivity: activityByFirm.get(firm.firmId ?? "") ?? null,
      };
    });
  return pipelineSort(built, sort.key, sort.reversed);
}

// ─── Stage filter ───────────────────────────────────────────────────────

/** One stage tab: every firm, one funnel stage, or the Passed outcome. */
export type StageFilter = Lifecycle | "all";

export const STAGE_FILTERS: readonly StageFilter[] = ["all", ...LIFECYCLE_BUCKETS];

const STAGE_BY_LOWER: ReadonlyMap<string, StageFilter> = new Map(
  STAGE_FILTERS.map((s) => [s.toLowerCase(), s]),
);

/** The stage a `?stage=` value names, ignoring case; anything else shows every firm. */
export function stageFromParam(raw: string | null | undefined): StageFilter {
  return STAGE_BY_LOWER.get((raw ?? "").trim().toLowerCase()) ?? "all";
}

/** The query value for a stage, or null for "all", which leaves the URL bare. */
export function stageToParam(stage: StageFilter): string | null {
  return stage === "all" ? null : stage;
}

export function rowsForStage(rows: readonly Row[], stage: StageFilter): Row[] {
  return stage === "all" ? [...rows] : rows.filter((r) => r.bucket === stage);
}

/** Firms per stage among `rows`, with `all` holding the total. */
export function stageCounts(rows: readonly Row[]): Record<StageFilter, number> {
  const counts = { ...emptyBucketCounts(), all: rows.length };
  for (const r of rows) {
    counts[r.bucket] += 1;
  }
  return counts;
}

// ─── Wording ────────────────────────────────────────────────────────────

// Human-readable label for a ReviewDecision.decisionType. Case- and separator-
// insensitive. Unknown types fall back to a title-cased version of the raw.
const DECISION_TYPE_LABEL: Record<string, string> = {
  accept: "Reviewed",
  enrich: "Enriched",
  reject: "Passed",
  re_engage: "Re-engaged",
  keep_passed: "Kept passed",
  acknowledge_drift: "Kept in pipeline",
  advance: "Advanced",
  activity: "Logged activity",
  qualify: "Qualified",
};

export function labelForDecisionType(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") {
    return "Activity";
  }
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (DECISION_TYPE_LABEL[normalized]) {
    return DECISION_TYPE_LABEL[normalized];
  }
  // Title-case the raw as a last resort.
  return raw
    .trim()
    .split(/[_\s-]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

/** "6h ago · Kept in pipeline". The time comes first: it is the part that must survive truncation. */
export function activityText(activity: LastActivity | null, now: number): string {
  if (activity === null) {
    return "None logged";
  }
  const age = relativeAge(toIsoTime(activity.decidedAt), now);
  const what = labelForDecisionType(activity.type);
  if (age === null) {
    return what;
  }
  return `${age === "now" ? "just now" : `${age} ago`} · ${what}`;
}

/** Why a firm is out, in one string for the cell tooltip and the detail panel. */
export function rejectText(mirror: ScoreResult, rationale: string | null): string {
  if (mirror.hardRejected) {
    return `Hard-rejected · ${mirror.rejectReason}`;
  }
  return rationale === null ? "Reason not on file" : `Pass reason · ${rationale}`;
}

/** True for a row the page shows as out: hard-screened, or in the Passed bucket. */
export function isOut(row: Pick<Row, "mirror" | "bucket">): boolean {
  return row.mirror.hardRejected || row.bucket === PASSED;
}

export const SORT_LABEL: Record<PipelineSortKey, string> = {
  stage: "stage, then score",
  score: "score",
  name: "name",
};

export function sortSummary(sort: PipelineSort): string {
  return `sorted by ${SORT_LABEL[sort.key]}${sort.reversed ? " (reversed)" : ""}`;
}

/**
 * The firm's profile as label and value pairs, leaving out what is not on file: every fact and
 * profile trait and every number the agent researches, in catalog order, then the geography.
 */
export function firmFacts(
  rubric: RubricContext,
  firm: FirmView,
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  for (const t of rubric.traits) {
    const v = traitOn(firm, t.traitKey);
    const shown = t.role !== "evidence" || t.kind === "number";
    if (shown && v !== undefined && v !== "") {
      facts.push({ label: t.label, value: showTraitValue(t, v) });
    }
  }
  if (firm.geographicFootprint) {
    facts.push({ label: "Geography", value: firm.geographicFootprint });
  }
  return facts;
}
