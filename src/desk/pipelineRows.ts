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

export type SortDirection = "ascending" | "descending";

/** The active sort: a key, and whether the header was clicked again to flip its natural direction. */
export interface PipelineSort {
  key: PipelineSortKey;
  reversed: boolean;
}

export const DEFAULT_SORT: PipelineSort = { key: "stage", reversed: false };

const NATURAL_DIRECTION: Record<PipelineSortKey, SortDirection> = {
  stage: "descending",
  score: "descending",
  name: "ascending",
};

/** The direction the rows run in, for `aria-sort` and the header arrow. */
export function sortDirection(sort: PipelineSort): SortDirection {
  const natural = NATURAL_DIRECTION[sort.key];
  if (!sort.reversed) {
    return natural;
  }
  return natural === "ascending" ? "descending" : "ascending";
}

/** A header click: a new key starts in its natural direction; the same key flips it. */
export function nextSort(current: PipelineSort, key: PipelineSortKey): PipelineSort {
  return key === current.key ? { key, reversed: !current.reversed } : { key, reversed: false };
}

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
 * first), then name. `reversed` runs the whole order backwards. Returns a new array.
 */
export function pipelineSort<T extends SortableRow>(
  rows: readonly T[],
  key: PipelineSortKey = "stage",
  reversed = false,
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
  const sorted = [...rows].sort(compare);
  return reversed ? sorted.reverse() : sorted;
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
 * Newest reject decision per firm, whole, in one pass. Only decisions whose
 * type contains "reject" count, so a later keep_passed or acknowledge_drift
 * never stands in for the reason a firm was passed. `decisions` must be
 * ordered newest first; the map iterates in that order too.
 */
export function latestRejection<D extends { firmId?: string | null; decisionType?: string | null }>(
  decisions: Iterable<D>,
): Map<string, D> {
  const byFirm = new Map<string, D>();
  for (const d of decisions) {
    const firmId = d.firmId ?? "";
    if (firmId === "" || byFirm.has(firmId)) {
      continue;
    }
    if (!(d.decisionType ?? "").toLowerCase().includes("reject")) {
      continue;
    }
    byFirm.set(firmId, d);
  }
  return byFirm;
}

/**
 * Newest reject decision per firm, reduced to what the Pipeline row shows. `decisions` must be ordered
 * newest first (the Pipeline query is decidedAt desc); the first reject seen
 * for a firm wins.
 */
export function rejectDecisionByFirm(
  decisions: Iterable<DecisionLike>,
): Map<string, RejectDecision> {
  const byFirm = new Map<string, RejectDecision>();
  for (const [firmId, d] of latestRejection(decisions)) {
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

/**
 * Where a navigation key sends the active row: the target index clamped to
 * the list, or null when the key is not a navigation key. A key at the edge
 * (ArrowUp on the first row) returns the current index, a no-op the caller
 * should still swallow.
 */
export function navTarget(key: string, index: number, count: number, page: number): number | null {
  let target: number;
  switch (key) {
    case "ArrowDown":
      target = index + 1;
      break;
    case "ArrowUp":
      target = index - 1;
      break;
    case "PageDown":
      target = index + page;
      break;
    case "PageUp":
      target = index - page;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = count - 1;
      break;
    default:
      return null;
  }
  return Math.max(0, Math.min(count - 1, target));
}

export type Segment = { kind: "spacer"; rows: number } | { kind: "row"; index: number };

/**
 * What the table body renders: the windowed rows, plus `pinned` (the row that
 * holds keyboard focus) even when it has scrolled out of the window, so focus
 * is never lost to an unmount. Everything else is a spacer of the right height.
 */
export function windowSegments(args: {
  start: number;
  end: number;
  count: number;
  pinned: number | null;
}): Segment[] {
  const { start, end, count, pinned } = args;
  const blocks: [number, number][] = [[start, end]];
  if (pinned !== null && pinned >= 0 && pinned < count && (pinned < start || pinned >= end)) {
    blocks.push([pinned, pinned + 1]);
    blocks.sort((a, b) => a[0] - b[0]);
  }
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [from, to] of blocks) {
    if (from > cursor) {
      segments.push({ kind: "spacer", rows: from - cursor });
    }
    for (let index = from; index < to; index += 1) {
      segments.push({ kind: "row", index });
    }
    cursor = Math.max(cursor, to);
  }
  if (count > cursor) {
    segments.push({ kind: "spacer", rows: count - cursor });
  }
  return segments;
}
