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
import { type MirrorResult, type ScoreInput, mirrorScore } from "@/desk/scoreMirror";
import {
  LIFECYCLE_BUCKETS,
  type Lifecycle,
  bucketOf,
  emptyBucketCounts,
} from "../../shared/pipelineBuckets";
import { PASSED } from "../../shared/vocab";
import { relativeAge, toIsoTime } from "../home/age";

// ─── Rows ───────────────────────────────────────────────────────────────

export interface FirmView {
  firmId?: string;
  firmName?: string | null;
  firmType?: string | null;
  coverageModel?: string | null;
  sector?: string | null;
  hqCountry?: string | null;
  employees?: number | null;
  revenueBand?: string | null;
  ownership?: string | null;
  successionRisk?: string | null;
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
  // Fields needed by mirrorScore:
  servicesFit?: string | null;
  mdPedigree?: string | null;
  balanceSheetPrincipal?: string | null;
  geoScore?: number | null;
  dealSizeMUsd?: number | null;
  dealsPerMdL3y?: number | null;
  firmAge?: number | null;
  feeGeneratingCount?: number | null;
  geographicFootprint?: string | null;
  advisoryConflict?: boolean | null;
}

export interface LastActivity {
  type: string;
  decidedAt: unknown;
}

export interface Row {
  firm: FirmView;
  mirror: MirrorResult;
  /** Score and tier shown for the row: at-decision for passed firms, live otherwise. */
  score: { total: number; tier: string };
  bucket: Lifecycle;
  rejectionRationale: string | null;
  lastActivity: LastActivity | null;
}

export function toScoreInput(f: FirmView): ScoreInput {
  return {
    firmType: f.firmType,
    coverageModel: f.coverageModel,
    servicesFit: f.servicesFit,
    mdPedigree: f.mdPedigree,
    balanceSheetPrincipal: f.balanceSheetPrincipal,
    geoScore: f.geoScore,
    dealSizeMUsd: f.dealSizeMUsd,
    dealsPerMdL3y: f.dealsPerMdL3y,
    firmAge: f.firmAge,
    employees: f.employees,
    feeGeneratingCount: f.feeGeneratingCount,
    geographicFootprint: f.geographicFootprint,
    advisoryConflict: f.advisoryConflict,
  };
}

export interface ProfileFilter {
  revenueBand: string;
  ownership: string;
  successionRisk: string;
}

export const NO_PROFILE_FILTER: ProfileFilter = {
  revenueBand: "",
  ownership: "",
  successionRisk: "",
};

export function hasProfileFilter(f: ProfileFilter): boolean {
  return f.revenueBand !== "" || f.ownership !== "" || f.successionRisk !== "";
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
  firms: readonly FirmView[];
  query: string;
  profile: ProfileFilter;
  sort: PipelineSort;
  rejectByFirm: ReadonlyMap<string, RejectDecision>;
  activityByFirm: ReadonlyMap<string, LastActivity>;
}): Row[] {
  const { firms, query, profile, sort, rejectByFirm, activityByFirm } = args;
  const needle = query.trim().toLowerCase();
  const built = firms
    .filter(
      (firm) =>
        (profile.revenueBand === "" || firm.revenueBand === profile.revenueBand) &&
        (profile.ownership === "" || firm.ownership === profile.ownership) &&
        (profile.successionRisk === "" || firm.successionRisk === profile.successionRisk),
    )
    .filter((firm) => matchesQuery(firm, needle))
    .map((firm): Row => {
      const mirror = mirrorScore(toScoreInput(firm));
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
export function rejectText(mirror: MirrorResult, rationale: string | null): string {
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

/** The firm's profile as label and value pairs, leaving out what is not on file. */
export function firmFacts(firm: FirmView): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== "") {
      facts.push({ label, value });
    }
  };
  add("Coverage", firm.coverageModel);
  add(
    "Employees",
    firm.employees === null || firm.employees === undefined ? null : String(firm.employees),
  );
  add("Revenue", firm.revenueBand);
  add("Ownership", firm.ownership);
  add("Succession risk", firm.successionRisk);
  add(
    "Deals / MD (L3Y)",
    firm.dealsPerMdL3y === null || firm.dealsPerMdL3y === undefined
      ? null
      : String(firm.dealsPerMdL3y),
  );
  add(
    "Avg deal size",
    firm.dealSizeMUsd === null || firm.dealSizeMUsd === undefined ? null : `$${firm.dealSizeMUsd}m`,
  );
  add(
    "Firm age",
    firm.firmAge === null || firm.firmAge === undefined ? null : `${firm.firmAge} yrs`,
  );
  add("Geography", firm.geographicFootprint);
  return facts;
}
