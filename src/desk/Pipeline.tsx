import React from "react";
import { Link } from "react-router-dom";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, ReviewDecision } from "@/data/ontology";
import {
  LIFECYCLE_STAGES,
  OWNERSHIP_TYPES,
  PASSED,
  REVENUE_BANDS,
  SUCCESSION_RISKS,
} from "../../shared/vocab";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
// Funnel vocabulary lives in one module so the Home strip and
// this page can't disagree about which stage a firm sits in.
import { type Lifecycle, STATUS_CHIP, bucketOf, emptyBucketCounts } from "./pipelineBuckets";
import {
  DEFAULT_SORT,
  type PipelineSort,
  type PipelineSortKey,
  type SortDirection,
  hqCode,
  navTarget,
  nextSort,
  pipelineSort,
  rejectDecisionByFirm,
  revealScrollTop,
  sortDirection,
  windowRange,
  windowSegments,
} from "./pipelineRows";
import { formatScore, scoreFraction, shownScore } from "./scoreFormat";
import { type MirrorResult, type ScoreInput, mirrorScore } from "./scoreMirror";
import { TIER_COLOR, TIER_LABEL, VOID_BG, outcomeChipStyle, outcomeLabel } from "./tokens";

// ─── Types ──────────────────────────────────────────────────────────────

interface FirmView {
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

function toScoreInput(f: FirmView): ScoreInput {
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

// ─── Lifecycle vocabulary ───────────────────────────────────────────────

// Chips inside the detail rail read across the funnel stages. Passed is an
// outcome, not a step, so it is shown (and filtered) separately.
const RAIL_STAGES: readonly Lifecycle[] = LIFECYCLE_STAGES;

// Human-readable label for a ReviewDecision.decisionType. Case- and separator-
// insensitive. Unknown types fall back to a title-cased version of the raw.
const DECISION_TYPE_LABEL: Record<string, string> = {
  accept: "Reviewed",
  enrich: "Enriched",
  reject: "Passed",
  re_engage: "Re-engaged",
  keep_passed: "Kept passed",
  advance: "Advanced",
  activity: "Logged activity",
  qualify: "Qualified",
};

function labelForDecisionType(raw: string | null | undefined): string {
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

// ─── Primitives ─────────────────────────────────────────────────────────

function Kicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatusChip({ stage }: { stage: Lifecycle }): React.ReactElement {
  const s = STATUS_CHIP[stage];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: "var(--radius-chip)",
        background: s.bg,
        color: s.fg,
        fontWeight: 400,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
        }}
      />
      {stage}
    </span>
  );
}

function TierTag({ tier }: { tier: string }): React.ReactElement {
  const c = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  return (
    <span
      className="tag"
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: c,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
      }}
    >
      {tier === "Rejected" ? "R" : tier}
    </span>
  );
}

function relativeTime(ts: unknown): string {
  if (ts === null || ts === undefined) {
    return "";
  }
  const d = typeof ts === "string" || typeof ts === "number" ? new Date(ts) : (ts as Date);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) {
    return "";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

// ─── Nav sidebar (shared with every workspace screen) ───────────────────

function NavSidebar(): React.ReactElement {
  return (
    <aside
      style={{
        width: 240,
        flex: "0 0 240px",
        borderRight: "1px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 12,
        minHeight: 0,
      }}
    >
      <BrandMark section="Pipeline" />
      <WorkspaceNavLinks />
    </aside>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

const SORT_LABEL: Record<PipelineSortKey, string> = {
  stage: "stage, then score",
  score: "score",
  name: "name",
};

function sortSummary(sort: PipelineSort): string {
  return `sorted by ${SORT_LABEL[sort.key]}${sort.reversed ? " (reversed)" : ""}`;
}

function PipelineHeader({
  shown,
  total,
  loading,
  sort,
  query,
  onQuery,
}: {
  shown: number;
  total: number;
  loading: boolean;
  sort: PipelineSort;
  query: string;
  onQuery: (v: string) => void;
}): React.ReactElement {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 22px",
        borderBottom: "1px solid var(--color-divider)",
        height: 56,
        flex: "0 0 56px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontWeight: 500, fontSize: 16 }}>Working set</span>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
          }}
        >
          {loading ? "Loading firms…" : `${shown} of ${total} firms · ${sortSummary(sort)}`}
        </span>
      </div>
      <div style={{ marginLeft: "auto", position: "relative", width: 260 }}>
        <input
          className="input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search firms, sectors, HQ…"
          style={{ paddingLeft: 30 }}
        />
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{ position: "absolute", left: 9, top: 11, opacity: 0.5, pointerEvents: "none" }}
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <Link to="/mandate" className="btn btn-primary" style={{ textDecoration: "none" }}>
        + New search
      </Link>
    </header>
  );
}

// ─── Profile filters ────────────────────────────────────────────────────

interface ProfileFilter {
  revenueBand: string;
  ownership: string;
  successionRisk: string;
}

const NO_PROFILE_FILTER: ProfileFilter = { revenueBand: "", ownership: "", successionRisk: "" };

const PROFILE_FILTERS: readonly {
  key: keyof ProfileFilter;
  label: string;
  options: readonly string[];
}[] = [
  { key: "revenueBand", label: "Revenue", options: REVENUE_BANDS },
  { key: "ownership", label: "Ownership", options: OWNERSHIP_TYPES },
  { key: "successionRisk", label: "Succession risk", options: SUCCESSION_RISKS },
];

function ProfileFilters({
  value,
  onChange,
}: {
  value: ProfileFilter;
  onChange: (next: ProfileFilter) => void;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {PROFILE_FILTERS.map(({ key, label, options }) => (
        <select
          key={key}
          className="input"
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          style={{ height: 32, width: "auto", minWidth: 150 }}
          aria-label={label}
        >
          <option value="">{label}: any</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}

// ─── Bucket counts ──────────────────────────────────────────────────────

function BucketCounts({
  counts,
  isLoading,
  passedOnly,
  onTogglePassed,
}: {
  counts: Record<Lifecycle, number>;
  // Passed is an outcome, not a funnel stage: it gets its own filter chip.
  passedOnly: boolean;
  onTogglePassed: () => void;
  // True while firms are still fetching. During that window every bucket
  // reads 0 (because the reducer sees no rows), so we must render a
  // skeleton — otherwise the tile falsely reads as "0 firms" for buckets
  // that actually have data on the way.
  isLoading: boolean;
}): React.ReactElement {
  const passed = STATUS_CHIP[PASSED];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 12,
        }}
      >
        {LIFECYCLE_STAGES.map((b) => {
          const s = STATUS_CHIP[b];
          const n = counts[b];
          return (
            <div
              key={b}
              style={{
                background: "var(--color-surface)",
                boxShadow: "var(--shadow-sm)",
                borderRadius: "var(--radius-md)",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {isLoading ? (
                <span
                  aria-hidden
                  style={{
                    display: "block",
                    height: 24,
                    width: 46,
                    borderRadius: "var(--radius-sm)",
                    background:
                      "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 16%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
                    backgroundSize: "200% 100%",
                    animation: "beacon-shimmer 1.6s linear infinite",
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: 21,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {n}
                </span>
              )}
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: s.dot,
                  }}
                />
                {b}
              </span>
            </div>
          );
        })}
      </div>
      <div>
        <button
          type="button"
          aria-pressed={passedOnly}
          onClick={onTogglePassed}
          title={passedOnly ? "Show every firm" : "Show only firms we passed on"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: "var(--radius-chip)",
            border: "1px solid var(--color-divider)",
            cursor: "pointer",
            background: passedOnly ? "var(--color-accent)" : passed.bg,
            color: passedOnly ? "var(--color-bg)" : passed.fg,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: passed.dot }} />
          {PASSED}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {isLoading ? "–" : counts[PASSED]}
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────

interface LastActivity {
  type: string;
  decidedAt: unknown;
}

interface Row {
  firm: FirmView;
  mirror: MirrorResult;
  /** Score and tier shown for the row: at-decision for passed firms, live otherwise. */
  score: { total: number; tier: string };
  bucket: Lifecycle;
  rejectionRationale: string | null;
  lastActivity: LastActivity | null;
}

/** Why a firm is out, in one string for the cell tooltip and the detail rail. */
function rejectText(mirror: MirrorResult, rationale: string | null): string {
  if (mirror.hardRejected) {
    return `Hard-rejected · ${mirror.rejectReason}`;
  }
  return rationale === null ? "Reason not on file" : `Pass reason · ${rationale}`;
}

const mutedText = "color-mix(in srgb, var(--color-text) 32%, transparent)";

// Fixed geometry: the body is windowed, so every row is exactly ROW_HEIGHT
// and the header exactly HEADER_HEIGHT (nocturne.css `.pipeline-grid`).
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 36;
const OVERSCAN = 6;
const COLUMN_COUNT = 8;

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function FirmRow({
  row,
  index,
  selected,
  tabbable,
  onSelect,
  onKeyDown,
}: {
  row: Row;
  index: number;
  selected: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => void;
}): React.ReactElement {
  const { firm, mirror, score, bucket, rejectionRationale, lastActivity } = row;
  const isRejected = mirror.hardRejected || bucket === PASSED;
  const tierColor = TIER_COLOR[score.tier] ?? TIER_COLOR.Rejected;
  const scoreText = formatScore(score.total);
  const barFill = scoreFraction(score.total);
  const reasonText = isRejected ? rejectText(mirror, rejectionRationale) : null;
  const name = firm.firmName ?? firm.firmId ?? "";
  // Time first: it is the part that must survive truncation.
  const activityText = lastActivity
    ? `${relativeTime(lastActivity.decidedAt)} · ${labelForDecisionType(lastActivity.type)}`
    : "None logged";

  return (
    <tr
      data-index={index}
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => {
        if (firm.firmId) {
          onSelect(firm.firmId);
        }
      }}
      onKeyDown={onKeyDown}
      style={{
        height: ROW_HEIGHT,
        cursor: firm.firmId ? "pointer" : "default",
        boxShadow: selected ? "inset 2px 0 0 var(--color-accent)" : "none",
        background: selected
          ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
          : "transparent",
      }}
    >
      <td style={{ overflow: "hidden" }}>
        <div
          style={{
            fontWeight: 500,
            textDecoration: isRejected ? "line-through" : "none",
            textDecorationColor: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            color: isRejected
              ? "color-mix(in srgb, var(--color-text) 62%, transparent)"
              : "inherit",
            ...ellipsis,
          }}
          title={name}
        >
          {name}
        </div>
        {firm.coverageModel && (
          <div
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
              ...ellipsis,
            }}
            title={firm.coverageModel}
          >
            {firm.coverageModel}
          </div>
        )}
      </td>
      <td>
        {firm.firmType && (
          <span className="tag tag-neutral" style={{ fontWeight: 600, fontSize: 10 }}>
            {firm.firmType}
          </span>
        )}
      </td>
      <td
        style={{
          ...ellipsis,
          color: firm.sector ? undefined : mutedText,
        }}
        title={firm.sector ?? undefined}
      >
        {firm.sector || "—"}
      </td>
      <td>
        <StatusChip stage={bucket} />
      </td>
      <td style={{ overflow: "hidden" }}>
        {reasonText !== null ? (
          // Score on its own line so it never clips; the reason sits below it.
          <div
            style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}
            title={`${formatScore(score.total, score.tier)} · ${reasonText}`}
          >
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {formatScore(score.total, score.tier)}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                ...ellipsis,
              }}
            >
              {reasonText}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: tierColor,
              }}
            >
              {scoreText}
            </span>
            <TierTag tier={score.tier} />
            <span
              style={{
                width: 24,
                height: 4,
                flex: "0 0 24px",
                borderRadius: "var(--radius-xs)",
                background: "var(--color-neutral-800)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: "0 auto 0 0",
                  width: `calc(100% * ${barFill})`,
                  background: tierColor,
                  borderRadius: "var(--radius-xs)",
                }}
              />
            </span>
          </div>
        )}
      </td>
      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {firm.employees ?? "—"}
      </td>
      <td
        style={{ ...ellipsis, color: firm.hqCountry ? undefined : mutedText }}
        title={firm.hqCountry || undefined}
      >
        {hqCode(firm.hqCountry)}
      </td>
      <td
        style={{
          fontSize: 12,
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          ...ellipsis,
        }}
        title={activityText}
      >
        {activityText}
      </td>
    </tr>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: PipelineSortKey;
  sort: PipelineSort;
  onSort: (key: PipelineSortKey) => void;
}): React.ReactElement {
  const isActive = sort.key === sortKey;
  const direction: SortDirection = sortDirection(sort);
  return (
    <th aria-sort={isActive ? direction : "none"}>
      <button type="button" className="th-sort" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden style={{ opacity: isActive ? 0.9 : 0 }}>
          {isActive && direction === "ascending" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}

/**
 * The table body is windowed: only the rows in view (plus overscan) are in the
 * DOM, with spacer rows standing in for the rest. The page's own scroll
 * container (`scrollRef`) drives it, so the bucket tiles above scroll away
 * naturally. One row holds the tab stop; arrow keys move focus, Enter or Space
 * selects.
 */
function WindowedTable({
  rows,
  selectedId,
  onSelect,
  scrollRef,
  sort,
  onSort,
}: {
  rows: Row[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  scrollRef: React.RefObject<HTMLElement>;
  sort: PipelineSort;
  onSort: (key: PipelineSortKey) => void;
}): React.ReactElement {
  const tableRef = React.useRef<HTMLTableElement>(null);
  const [range, setRange] = React.useState({ start: 0, end: 30 });
  const count = rows.length;
  // The active row is tracked by firm, not position, so re-sorting keeps it on the same firm.
  const [activeId, setActiveState] = React.useState<string | undefined>(undefined);
  // The logical active row. Key handling reads this, not the focused element, so a
  // key pressed before DOM focus has caught up with the last move still acts on the right row.
  const activeRef = React.useRef<string | undefined>(undefined);
  const setActiveId = React.useCallback((id: string | undefined) => {
    activeRef.current = id;
    setActiveState(id);
  }, []);
  // The row that holds DOM focus, if any. It stays rendered when it scrolls out of the window.
  const [focusedId, setFocusedId] = React.useState<string | undefined>(undefined);
  const focusPending = React.useRef(false);
  const indexById = React.useMemo(
    () => new Map(rows.map((r, i) => [r.firm.firmId ?? "", i] as const)),
    [rows],
  );
  const indexOf = (id: string | undefined): number =>
    Math.min(Math.max(0, indexById.get(id ?? "") ?? 0), count - 1);
  const activeIndex = indexOf(activeId);

  // How far the table's top edge has scrolled past the top of the scroll container.
  const tableScrollTop = React.useCallback((): number => {
    const scroller = scrollRef.current;
    const table = tableRef.current;
    if (scroller === null || table === null) {
      return 0;
    }
    return scroller.getBoundingClientRect().top - table.getBoundingClientRect().top;
  }, [scrollRef]);

  const measure = React.useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    const next = windowRange({
      scrollTop: tableScrollTop(),
      viewportHeight: scroller.clientHeight,
      rowHeight: ROW_HEIGHT,
      count,
      overscan: OVERSCAN,
    });
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [scrollRef, tableScrollTop, count]);

  const reveal = React.useCallback(
    (index: number) => {
      const scroller = scrollRef.current;
      if (scroller === null) {
        return;
      }
      const current = tableScrollTop();
      const target = revealScrollTop({
        scrollTop: current,
        viewportHeight: scroller.clientHeight,
        headerHeight: HEADER_HEIGHT,
        rowHeight: ROW_HEIGHT,
        index,
      });
      if (target !== current) {
        scroller.scrollTop += target - current;
      }
    },
    [scrollRef, tableScrollTop],
  );

  React.useLayoutEffect(() => {
    measure();
    const scroller = scrollRef.current;
    if (scroller === null) {
      return undefined;
    }
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure, scrollRef]);

  // A newly selected row (keyboard, or a link in) is scrolled into view.
  const selectedIndex = React.useMemo(
    () => (selectedId === undefined ? -1 : rows.findIndex((r) => r.firm.firmId === selectedId)),
    [rows, selectedId],
  );
  const selectedIndexRef = React.useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  React.useEffect(() => {
    if (selectedIndexRef.current >= 0) {
      reveal(selectedIndexRef.current);
    }
  }, [selectedId, reveal]);

  // Keyboard focus follows the active row once it is in the DOM. Only while focus is still in
  // the table: if the user has moved on (clicked the search box), a stale move is dropped.
  React.useEffect(() => {
    if (!focusPending.current) {
      return;
    }
    const table = tableRef.current;
    if (table === null || !table.contains(document.activeElement)) {
      focusPending.current = false;
      return;
    }
    const el = table.querySelector<HTMLElement>(`tr[data-index="${activeIndex}"]`);
    if (el) {
      focusPending.current = false;
      el.focus({ preventScroll: true });
    }
  });

  const moveTo = (next: number): void => {
    if (next === indexOf(activeRef.current)) {
      return;
    }
    focusPending.current = true;
    setActiveId(rows[next]?.firm.firmId ?? "");
    reveal(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    const index = indexOf(activeRef.current);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT) - 2);
    const target = navTarget(e.key, index, count, page);
    if (target !== null) {
      moveTo(target);
    } else if (e.key === "Enter" || e.key === " ") {
      const id = rows[index]?.firm.firmId;
      if (id) {
        onSelect(id);
      }
    } else {
      return;
    }
    e.preventDefault();
  };

  const handleSort = (key: PipelineSortKey): void => {
    onSort(key);
    // A new order starts at the top of the table.
    const scroller = scrollRef.current;
    const above = tableScrollTop();
    if (scroller !== null && above > 0) {
      scroller.scrollTop -= above;
    }
  };

  const start = Math.min(range.start, count);
  const end = Math.min(range.end, count);
  const focusedIndex = focusedId === undefined ? null : (indexById.get(focusedId) ?? null);
  const segments = windowSegments({ start, end, count, pinned: focusedIndex });
  // The tab stop is the active row when it is rendered, else the nearest rendered one, so
  // Tab can always reach the table.
  const activeRendered =
    (activeIndex >= start && activeIndex < end) || activeIndex === focusedIndex;
  const tabIndexRow = activeRendered
    ? activeIndex
    : Math.max(start, Math.min(end - 1, activeIndex));

  return (
    <table
      ref={tableRef}
      className="table pipeline-grid"
      role="grid"
      aria-label="Firms"
      aria-rowcount={count + 1}
      style={{ tableLayout: "fixed", width: "100%" }}
    >
      {/* Fixed column widths: Status and Fit each own their cell, so a chip can't
          run into the next column, and Firm takes whatever width is left. */}
      <colgroup>
        <col />
        <col style={{ width: 48 }} />
        <col style={{ width: 88 }} />
        <col style={{ width: 112 }} />
        <col style={{ width: 128 }} />
        <col style={{ width: 48 }} />
        <col style={{ width: 44 }} />
        <col style={{ width: 136 }} />
      </colgroup>
      <thead>
        <tr aria-rowindex={1}>
          <SortHeader label="Firm" sortKey="name" sort={sort} onSort={handleSort} />
          <th>Type</th>
          <th>Sector</th>
          <SortHeader label="Status" sortKey="stage" sort={sort} onSort={handleSort} />
          <SortHeader label="Fit" sortKey="score" sort={sort} onSort={handleSort} />
          <th style={{ textAlign: "right" }}>Emp.</th>
          <th>HQ</th>
          <th>Activity</th>
        </tr>
      </thead>
      <tbody
        onFocus={(e) => {
          const index = Number((e.target as HTMLElement).dataset.index);
          if (Number.isInteger(index) && rows[index]) {
            const id = rows[index].firm.firmId ?? "";
            setActiveId(id);
            setFocusedId(id);
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocusedId(undefined);
          }
        }}
      >
        {segments.map((seg, i) => {
          if (seg.kind === "spacer") {
            return (
              <tr
                key={`spacer-${i}`}
                className="pipeline-spacer"
                aria-hidden="true"
                style={{ height: seg.rows * ROW_HEIGHT }}
              >
                <td colSpan={COLUMN_COUNT} />
              </tr>
            );
          }
          const r = rows[seg.index];
          return (
            <FirmRow
              key={r.firm.firmId ?? `row-${seg.index}`}
              row={r}
              index={seg.index}
              selected={r.firm.firmId === selectedId}
              tabbable={seg.index === tabIndexRow}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function FirmsTable({
  rows,
  selectedId,
  onSelect,
  isLoading,
  scrollRef,
  sort,
  onSort,
}: {
  rows: Row[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  isLoading: boolean;
  scrollRef: React.RefObject<HTMLElement>;
  sort: PipelineSort;
  onSort: (key: PipelineSortKey) => void;
}): React.ReactElement {
  if (isLoading && rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 6px",
          fontSize: 11,
          color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid var(--color-neutral-700)",
            borderTopColor: "var(--color-accent)",
            animation: "bcn-spin .7s linear infinite",
          }}
        />
        Loading firms…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
          padding: "60px 20px",
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-neutral-800)",
            display: "grid",
            placeItems: "center",
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <div style={{ fontSize: 16, fontWeight: 500 }}>No firms match that search</div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            maxWidth: "40ch",
          }}
        >
          Try a broader sector or geography, or start a fresh discovery run.
        </p>
      </div>
    );
  }

  return (
    <WindowedTable
      rows={rows}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollRef={scrollRef}
      sort={sort}
      onSort={onSort}
    />
  );
}

// ─── Detail rail ────────────────────────────────────────────────────────

// Outcome chip for the detail rail — same visual language as the desk
// header chip, `acquired_by_competitor` in muted red.
function DetailOutcomeChip({
  outcome,
  observedAt,
}: {
  outcome: string;
  observedAt: string | number | Date | null | undefined;
}): React.ReactElement {
  const style = outcomeChipStyle(outcome);
  const label = outcomeLabel(outcome);
  const dateStr = formatOutcomeDate(observedAt);
  const tooltip = dateStr === null ? `Outcome: ${label}` : `Outcome: ${label} · ${dateStr}`;
  return (
    <span
      className="tag"
      title={tooltip}
      style={{
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: "var(--radius-chip)",
        color: style.fg,
        background: style.bg,
        border: `1px solid ${style.border}`,
        fontWeight: 500,
      }}
    >
      Outcome: {label}
      {dateStr !== null && (
        <span style={{ opacity: 0.75, marginLeft: 6, fontWeight: 400 }}>· {dateStr}</span>
      )}
    </span>
  );
}

function formatOutcomeDate(raw: string | number | Date | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  return new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function DetailRail({ row }: { row: Row | undefined }): React.ReactElement {
  if (row === undefined) {
    return (
      <aside style={railShellStyle}>
        <div
          style={{
            margin: "auto",
            textAlign: "center",
            padding: 32,
            color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            fontSize: 13,
          }}
        >
          Select a firm to see its qualification status and facts.
        </div>
      </aside>
    );
  }

  const { firm, mirror, score, bucket, rejectionRationale } = row;
  const isReject = mirror.hardRejected || bucket === PASSED;
  const tierColor = TIER_COLOR[score.tier] ?? TIER_COLOR.Rejected;
  const barFill = scoreFraction(score.total);
  const tierNote = mirror.hardRejected
    ? "Hard-rejected by the screen"
    : score.tier === "Rejected"
      ? "Below the C threshold"
      : (TIER_LABEL[score.tier] ?? "");

  const facts: { k: string; v: string }[] = [];
  if (firm.coverageModel) {
    facts.push({ k: "Coverage", v: firm.coverageModel });
  }
  if (firm.employees !== null && firm.employees !== undefined) {
    facts.push({ k: "Employees", v: String(firm.employees) });
  }
  if (firm.revenueBand) {
    facts.push({ k: "Revenue", v: firm.revenueBand });
  }
  if (firm.ownership) {
    facts.push({ k: "Ownership", v: firm.ownership });
  }
  if (firm.successionRisk) {
    facts.push({ k: "Succession risk", v: firm.successionRisk });
  }
  if (firm.dealsPerMdL3y !== null && firm.dealsPerMdL3y !== undefined) {
    facts.push({ k: "Deals / MD (L3Y)", v: String(firm.dealsPerMdL3y) });
  }
  if (firm.dealSizeMUsd !== null && firm.dealSizeMUsd !== undefined) {
    facts.push({ k: "Avg deal size", v: `$${firm.dealSizeMUsd}m` });
  }
  if (firm.firmAge !== null && firm.firmAge !== undefined) {
    facts.push({ k: "Firm age", v: `${firm.firmAge} yrs` });
  }
  if (firm.geographicFootprint) {
    facts.push({ k: "Geography", v: firm.geographicFootprint });
  }

  return (
    <aside style={railShellStyle}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 19, lineHeight: 1.15 }}>
            {firm.firmName ?? firm.firmId}
          </span>
          {firm.firmType && (
            <span className="tag tag-neutral" style={{ fontWeight: 600, fontSize: 10 }}>
              {firm.firmType}
            </span>
          )}
        </div>
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}
        >
          {firm.sector && <span className="tag tag-outline">{firm.sector}</span>}
          {firm.hqCountry && (
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {firm.hqCountry}
            </span>
          )}
        </div>
        {firm.outcome && firm.outcome.trim() !== "" && (
          <div style={{ marginTop: 8 }}>
            <DetailOutcomeChip outcome={firm.outcome} observedAt={firm.outcomeObservedAt} />
          </div>
        )}
      </div>

      <div>
        <Kicker style={{ marginBottom: 8 }}>
          Qualification status{" "}
          <span
            style={{
              letterSpacing: 0,
              textTransform: "none",
              color: "color-mix(in srgb, var(--color-text) 32%, transparent)",
            }}
          >
            (read-only)
          </span>
        </Kicker>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {RAIL_STAGES.map((s) => {
            const active = bucket === s;
            return (
              <span
                key={s}
                style={{
                  fontSize: 11,
                  padding: "4px 9px",
                  borderRadius: "var(--radius-chip)",
                  fontWeight: active ? 500 : 400,
                  background: active ? "var(--color-accent)" : "var(--color-neutral-800)",
                  color: active
                    ? "var(--color-bg)"
                    : "color-mix(in srgb, var(--color-text) 55%, transparent)",
                }}
              >
                {s}
              </span>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 12,
          background: "var(--color-surface)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: tierColor,
            }}
          >
            {formatScore(score.total)}
          </span>
          <Kicker>Fit score</Kicker>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              height: 6,
              borderRadius: "var(--radius-xs)",
              background: "var(--color-neutral-800)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `calc(100% * ${barFill})`,
                background: tierColor,
                borderRadius: "var(--radius-xs)",
              }}
            />
          </span>
          <span style={{ fontSize: 11, color: tierColor }}>
            {bucket} · {formatScore(score.total, score.tier)}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            {tierNote}
          </span>
        </div>
      </div>

      {isReject && (
        <div
          style={{
            fontSize: 13,
            padding: 12,
            borderRadius: "var(--radius-md)",
            background: "rgba(207,112,112,.12)",
            color: "#e79191",
            fontWeight: 500,
          }}
        >
          {rejectText(mirror, rejectionRationale)}
        </div>
      )}

      {facts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker>Firm facts</Kicker>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "116px 1fr",
              gap: "7px 10px",
              fontSize: 13,
            }}
          >
            {facts.map((f) => (
              <React.Fragment key={f.k}>
                <span
                  style={{
                    color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                  }}
                >
                  {f.k}
                </span>
                <span style={{ overflowWrap: "anywhere" }}>{f.v}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
        {!isReject && (
          <Link
            to={`/desk?firmId=${encodeURIComponent(firm.firmId ?? "")}`}
            className="btn btn-primary btn-block"
            style={{ textDecoration: "none" }}
          >
            Open in enrichment desk
          </Link>
        )}
      </div>
    </aside>
  );
}

const railShellStyle: React.CSSProperties = {
  borderLeft: "1px solid var(--color-divider)",
  overflow: "auto",
  // Bottom padding clears the fixed demo notice so the CTA is never covered.
  padding: "18px 18px 72px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minHeight: 0,
  flex: "0 0 384px",
  width: 384,
};

// ─── Root ───────────────────────────────────────────────────────────────

function Pipeline(): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });

  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [query, setQuery] = React.useState("");
  const [passedOnly, setPassedOnly] = React.useState(false);
  const [profileFilter, setProfileFilter] = React.useState<ProfileFilter>(NO_PROFILE_FILTER);
  const [sort, setSort] = React.useState<PipelineSort>(DEFAULT_SORT);
  const scrollRef = React.useRef<HTMLElement>(null);

  const firms = React.useMemo(() => (data ?? []) as unknown as FirmView[], [data]);

  // Newest reject decision per firm: the pass reason, and the score and tier
  // the firm was passed at. Decisions are ordered newest first.
  const rejectByFirm = React.useMemo(
    () => rejectDecisionByFirm(decisionsData ?? []),
    [decisionsData],
  );

  // Most-recent decision per firm — real activity, not the pipeline-builder
  // default lastReviewed date. The query is ordered by decidedAt desc, so
  // the first entry per firmId is the most recent.
  const lastActivityByFirm = React.useMemo(() => {
    const m = new Map<string, LastActivity>();
    for (const d of decisionsData ?? []) {
      const fid = d.firmId ?? null;
      if (fid === null || fid === "") {
        continue;
      }
      if (m.has(fid)) {
        continue;
      }
      m.set(fid, {
        type: (d.decisionType ?? "decision").toString(),
        decidedAt: d.decidedAt,
      });
    }
    return m;
  }, [decisionsData]);

  const rows = React.useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const built = firms
      .filter(
        (firm) =>
          (profileFilter.revenueBand === "" || firm.revenueBand === profileFilter.revenueBand) &&
          (profileFilter.ownership === "" || firm.ownership === profileFilter.ownership) &&
          (profileFilter.successionRisk === "" ||
            firm.successionRisk === profileFilter.successionRisk),
      )
      .filter(
        (firm) =>
          needle === "" ||
          (firm.firmName ?? "").toLowerCase().includes(needle) ||
          (firm.sector ?? "").toLowerCase().includes(needle) ||
          (firm.hqCountry ?? "").toLowerCase().includes(needle) ||
          (firm.firmId ?? "").toLowerCase().includes(needle),
      )
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
          lastActivity: lastActivityByFirm.get(firm.firmId ?? "") ?? null,
        };
      });
    return pipelineSort(built, sort.key, sort.reversed);
  }, [firms, query, profileFilter, sort, rejectByFirm, lastActivityByFirm]);

  const counts = React.useMemo(() => {
    const c = emptyBucketCounts();
    for (const r of rows) {
      c[r.bucket] += 1;
    }
    return c;
  }, [rows]);

  const visibleRows = React.useMemo(
    () => (passedOnly ? rows.filter((r) => r.bucket === PASSED) : rows),
    [rows, passedOnly],
  );

  const selectedRow = React.useMemo(
    () => visibleRows.find((r) => r.firm.firmId === selectedId),
    [visibleRows, selectedId],
  );

  return (
    <div
      className="dsn"
      style={{
        position: "fixed",
        inset: 0,
        background: VOID_BG,
        display: "flex",
      }}
    >
      <NavSidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <PipelineHeader
          shown={visibleRows.length}
          total={firms.length}
          loading={isLoading && firms.length === 0}
          sort={sort}
          query={query}
          onQuery={setQuery}
        />
        {error && (
          <div
            style={{
              padding: "8px 22px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {String(error)}
          </div>
        )}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <main
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 22px 72px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 0,
            }}
          >
            {/* The scroll container has no top padding so the sticky table header sits flush with its edge. */}
            <div style={{ paddingTop: 18 }}>
              <BucketCounts
                counts={counts}
                isLoading={isLoading && firms.length === 0}
                passedOnly={passedOnly}
                onTogglePassed={() => setPassedOnly((v) => !v)}
              />
            </div>
            <ProfileFilters value={profileFilter} onChange={setProfileFilter} />
            <FirmsTable
              rows={visibleRows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              isLoading={isLoading}
              scrollRef={scrollRef}
              sort={sort}
              onSort={(key) => setSort((current) => nextSort(current, key))}
            />
          </main>
          <DetailRail row={selectedRow} />
        </div>
      </div>
    </div>
  );
}

export default Pipeline;
