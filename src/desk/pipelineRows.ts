/**
 * Pure row logic for the Pipeline table: sorting, the reject-decision lookup,
 * the compact HQ code, and the windowing arithmetic behind the virtualized
 * body. No React, no DOM.
 */
import { COUNTRY_CODE } from "../../shared/taxonomy";
import { LIFECYCLE_STAGES } from "../../shared/vocab";

// ─── Sorting ────────────────────────────────────────────────────────────

/** stage: furthest along first · score: highest first · name: A to Z. */
export type PipelineSortKey = "stage" | "score" | "name";

/** The slice of a Pipeline row the sort reads. */
export interface SortableRow {
  bucket: string;
  score: { total: number };
  firm: { firmId?: string | null; firmName?: string | null };
}

const STAGE_RANK: ReadonlyMap<string, number> = new Map(LIFECYCLE_STAGES.map((s, i) => [s, i]));

/** Funnel position, Discovered 0 … Closed 7. Passed is an outcome, not a step, so it ranks below Discovered. */
function stageRank(bucket: string): number {
  return STAGE_RANK.get(bucket) ?? -1;
}

function nameOf(row: SortableRow): string {
  return row.firm.firmName ?? row.firm.firmId ?? "";
}

function byName(a: SortableRow, b: SortableRow): number {
  return (
    nameOf(a).localeCompare(nameOf(b)) || (a.firm.firmId ?? "").localeCompare(b.firm.firmId ?? "")
  );
}

/**
 * Order Pipeline rows. The default, "stage", puts the deal furthest along
 * first (Closed … Discovered) with Passed last; ties fall to score (highest
 * first), then name. Returns a new array.
 */
export function pipelineSort<T extends SortableRow>(
  rows: readonly T[],
  key: PipelineSortKey = "stage",
): T[] {
  const compare = (a: T, b: T): number => {
    switch (key) {
      case "name":
        return byName(a, b);
      case "score":
        return b.score.total - a.score.total || byName(a, b);
      case "stage":
        return (
          stageRank(b.bucket) - stageRank(a.bucket) || b.score.total - a.score.total || byName(a, b)
        );
    }
  };
  return [...rows].sort(compare);
}

// ─── Reject decisions ───────────────────────────────────────────────────

/** What a firm's most recent reject decision recorded. */
export interface RejectDecision {
  rationale: string | null;
  scoreAtDecision: number | null;
  tierAtDecision: string | null;
}

/** The ReviewDecision fields the lookup reads. */
export interface DecisionLike {
  firmId?: string | null;
  decisionType?: string | null;
  rejectionRationale?: string | null;
  scoreAtDecision?: number | null;
  tierAtDecision?: string | null;
}

/**
 * Newest reject decision per firm, in one pass. `decisions` must be ordered
 * newest first (the Pipeline query is decidedAt desc); the first reject seen
 * for a firm wins.
 */
export function rejectDecisionByFirm(
  decisions: Iterable<DecisionLike>,
): Map<string, RejectDecision> {
  const byFirm = new Map<string, RejectDecision>();
  for (const d of decisions) {
    const firmId = d.firmId ?? "";
    if (firmId === "" || byFirm.has(firmId)) {
      continue;
    }
    if (!(d.decisionType ?? "").toLowerCase().includes("reject")) {
      continue;
    }
    const rationale = (d.rejectionRationale ?? "").trim();
    byFirm.set(firmId, {
      rationale: rationale === "" ? null : rationale,
      scoreAtDecision: d.scoreAtDecision ?? null,
      tierAtDecision: d.tierAtDecision ?? null,
    });
  }
  return byFirm;
}

// ─── HQ ─────────────────────────────────────────────────────────────────

/** Compact HQ for a narrow cell: the country code, or the name as given when there is no code. */
export function hqCode(country: string | null | undefined): string {
  const name = (country ?? "").trim();
  if (name === "") {
    return "—";
  }
  return COUNTRY_CODE[name] ?? name;
}

// ─── Windowing ──────────────────────────────────────────────────────────

/**
 * Rows to render for a fixed-height list: the visible ones plus `overscan` on
 * each side. `scrollTop` is how far the first row's top edge has scrolled past
 * the top of the viewport (negative while the list is still below it).
 */
export function windowRange(args: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan: number;
}): { start: number; end: number } {
  const { scrollTop, viewportHeight, rowHeight, count, overscan } = args;
  const top = Math.max(0, scrollTop);
  const bottom = scrollTop + viewportHeight;
  const end = Math.min(count, Math.max(0, Math.ceil(bottom / rowHeight)) + overscan);
  const start = Math.max(0, Math.min(Math.floor(top / rowHeight), count) - overscan);
  return { start, end: Math.max(start, end) };
}

/**
 * The scrollTop that brings row `index` fully into view, or the current one
 * if it already is. The `headerHeight` header sticks to the top edge and
 * covers whatever scrolls under it; rows start `headerHeight` below the list's
 * top edge.
 */
export function revealScrollTop(args: {
  scrollTop: number;
  viewportHeight: number;
  headerHeight: number;
  rowHeight: number;
  index: number;
}): number {
  const { scrollTop, viewportHeight, headerHeight, rowHeight, index } = args;
  const rowTop = headerHeight + index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop < Math.max(scrollTop, 0) + headerHeight) {
    return rowTop - headerHeight;
  }
  if (rowBottom > scrollTop + viewportHeight) {
    return rowBottom - viewportHeight;
  }
  return scrollTop;
}
