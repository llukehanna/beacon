import React from "react";
import { Link } from "react-router-dom";
import { useOsdkQuery } from "@/data/hooks";
import type {
  HomeSummary,
  MandateSummary,
  NeedsYouDestination,
  NeedsYouItem,
} from "../../shared/summaries";
import { PASSED } from "../../shared/vocab";
import { formatMandateFirmCounts } from "./mandateFirms";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import { LIFECYCLE_BUCKETS, type Lifecycle } from "./pipelineBuckets";
import {
  DIVERGENCE_BG,
  DIVERGENCE_BORDER,
  DIVERGENCE_FG,
  DIVERGENCE_PHRASE,
  OUTCOME_ACQUIRED,
  VOID_BG,
  driftReasonPresentation,
  outcomeLabel,
} from "./tokens";
import { INSUFFICIENT_THRESHOLD, OUTCOME_SLOTS } from "./trustMetrics";

/**
 * Home — the start-of-day operations page.
 *
 * Two columns: an operational spine on the left (triage inbox → mandates →
 * funnel) and a trust rail on the right. Every row and every number links
 * to the surface where that work happens; nothing here is render-only, and
 * the funnel strip is the only visualization.
 *
 * Every figure comes from the `homeSummary` query function, which applies
 * the SAME shared rules the destination pages use — queue.ts for the
 * workable band, pipelineBuckets.ts for the funnel, trustMetrics.ts for
 * abstention/agreement, axisState.ts for needs-you axes. Home must never
 * promise work the page it links to doesn't show. This file only decides
 * how the numbers look.
 */

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

function SectionHead({
  title,
  href,
  linkLabel,
}: {
  title: React.ReactNode;
  href: string;
  linkLabel: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 8,
      }}
    >
      <Kicker>{title}</Kicker>
      <Link className="home-quiet-link" to={href} style={{ fontSize: 12 }}>
        {linkLabel} →
      </Link>
    </div>
  );
}

// Numbers must never read "0" while their query is in flight — a premature
// zero on this page says "nothing needs you", which is the one lie a
// start-of-day screen can't tell. Same shimmer Pipeline's tiles use.
function Shimmer({ w, h }: { w: number; h: number }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        height: h,
        width: w,
        borderRadius: "var(--radius-sm)",
        verticalAlign: "middle",
        background:
          "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 16%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
        backgroundSize: "200% 100%",
        animation: "beacon-shimmer 1.6s linear infinite",
      }}
    />
  );
}

// ─── Triage inbox ───────────────────────────────────────────────────────

// One destination per item type — also decides where "+N more" points.
type Destination = NeedsYouDestination;

const DESTINATION_PATH: Record<Destination, string> = {
  review: "/review",
  desk: "/desk",
  rules: "/rules",
};

// Rail colours. Drift rows reuse /review's per-reason vocabulary verbatim
// (violet divergence, amber invalidated pass reason, red tier move) so a
// row here and the card it opens wear the same colour. Judgment rows take
// the desk's teal; rule rows take the blue of /rules' own Pending chip.
const JUDGMENT_RAIL = "color-mix(in srgb, var(--color-accent) 55%, transparent)";
const JUDGMENT_FG = "var(--color-accent-300)";
const RULE_RAIL = "color-mix(in srgb, #4a90d9 55%, transparent)";
const RULE_FG = "#8ec1ee";

/** How one needs-you item reads on screen; the summary carries only the data. */
interface InboxItem {
  key: string;
  to: string;
  rail: string;
  name: string;
  story: React.ReactNode;
  storyColor: string;
  typeLabel: string;
}

function toInboxItem(item: NeedsYouItem): InboxItem {
  switch (item.kind) {
    case "drift": {
      const reason = driftReasonPresentation(item.driftReason);
      const rank = item.rank;
      const tierMove =
        item.priorTier && item.newTier
          ? `${item.priorTier} ${item.priorScore ?? ""} → ${item.newTier} ${item.newScore ?? ""}`.replace(
              /\s+/g,
              " ",
            )
          : null;
      return {
        key: item.key,
        to: "/review",
        rail: reason.border,
        name: item.name,
        story:
          rank === 0
            ? DIVERGENCE_PHRASE
            : rank === 1
              ? "pass reason invalidated"
              : tierMove !== null
                ? `tier moved · ${tierMove}`
                : reason.label.toLowerCase(),
        storyColor: reason.fg,
        typeLabel: rank === 0 ? "Divergence" : rank === 1 ? "Pass reason" : "Tier moved",
      };
    }
    case "judgment":
      return {
        key: item.key,
        // /desk reads ?firmId and opens that firm's panel, so the click
        // lands on the work rather than near it.
        to: `/desk?firmId=${encodeURIComponent(item.firmId)}`,
        rail: JUDGMENT_RAIL,
        name: item.name,
        story: `${item.axes} ${item.axes === 1 ? "axis" : "axes"} with no source`,
        storyColor: JUDGMENT_FG,
        typeLabel: "Judgment",
      };
    case "rule":
      return {
        key: item.key,
        to: "/rules",
        rail: RULE_RAIL,
        name: item.name,
        // null = not computable (a text predicate), not "screens nobody".
        story:
          item.screens === null
            ? "projection not computed yet"
            : `would screen ${item.screens} firm${item.screens === 1 ? "" : "s"}`,
        storyColor: RULE_FG,
        typeLabel: "Rule",
      };
  }
}

function InboxRow({ item, last }: { item: InboxItem; last: boolean }): React.ReactElement {
  return (
    <Link
      to={item.to}
      className="home-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 13px 9px 12px",
        textDecoration: "none",
        color: "inherit",
        borderLeftStyle: "solid",
        borderLeftWidth: 3,
        borderLeftColor: item.rail,
        borderBottomStyle: "solid",
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: "var(--color-divider)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          flex: "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={item.name}
      >
        {item.name}
      </span>
      <span
        style={{
          fontSize: 13,
          color: item.storyColor,
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.story}
      </span>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
          flex: "none",
        }}
      >
        {item.typeLabel}
      </span>
    </Link>
  );
}

// Zero-states are a quiet line at the foot of the stack, never a card —
// an empty type still says what it would say, without taking up the room
// of work that exists.
function QuietLine({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
        padding: "7px 13px",
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Mandate row ────────────────────────────────────────────────────────

function MandateRow({ mandate }: { mandate: MandateSummary }): React.ReactElement {
  const headline =
    (mandate.intentStatement ?? "").trim() || (mandate.title ?? "").trim() || mandate.mandateId;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderBottom: "1px solid var(--color-divider)",
        minWidth: 0,
      }}
    >
      {/* One line per mandate: the sentence ellipsizes rather than wrapping
          the row to two lines, with the full text on the title. */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={headline}
      >
        {headline}
      </span>
      <Link
        className="home-quiet-link"
        to="/desk"
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          flex: "none",
          whiteSpace: "nowrap",
        }}
        title="Scoped = every firm in this mandate's lists and searches. From searches = the subset a Search run attached."
      >
        {formatMandateFirmCounts(mandate)}
      </Link>
      <Link
        to={`/search/${encodeURIComponent(mandate.mandateId)}`}
        style={{
          fontSize: 12,
          color: "var(--color-accent)",
          textDecoration: "none",
          flex: "none",
          whiteSpace: "nowrap",
        }}
        title="Turn this intent sentence into a Search"
      >
        Interpret &amp; run search →
      </Link>
      <Link
        to="/desk"
        style={{
          fontSize: 12,
          color: "var(--color-accent)",
          textDecoration: "none",
          flex: "none",
          whiteSpace: "nowrap",
        }}
      >
        Work in desk →
      </Link>
    </div>
  );
}

// ─── Funnel strip ───────────────────────────────────────────────────────

function FunnelStrip({
  counts,
}: {
  /** Undefined while the summary is in flight. */
  counts: Record<Lifecycle, number> | undefined;
}): React.ReactElement {
  const loading = counts === undefined;
  return (
    <Link
      to="/pipeline"
      className="home-row"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 0,
        flexWrap: "wrap",
        padding: 12,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-divider)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      {LIFECYCLE_BUCKETS.map((b, i) => {
        const n = counts?.[b] ?? 0;
        // A zero stage still holds its place in the funnel — dimmed, not
        // dropped, so the shape of the pipeline stays readable.
        const dim = !loading && n === 0;
        return (
          <React.Fragment key={b}>
            {i > 0 && (
              <span
                aria-hidden
                style={{
                  padding: "0 9px",
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 24%, transparent)",
                }}
              >
                {b === PASSED ? "|" : "→"}
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 4,
                opacity: dim ? 0.4 : 1,
              }}
            >
              {loading ? (
                <Shimmer w={26} h={14} />
              ) : (
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {n}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 52%, transparent)",
                  whiteSpace: "nowrap",
                }}
              >
                {b}
              </span>
            </span>
          </React.Fragment>
        );
      })}
    </Link>
  );
}

// ─── Trust rail ─────────────────────────────────────────────────────────

function OutcomeCell({
  slot,
  count,
  loading,
}: {
  slot: string;
  count: number;
  loading: boolean;
}): React.ReactElement {
  // acquired_by_competitor is the divergence story in aggregate — the firms
  // we passed on that the market bought. Violet, matching the review
  // entries it generates. Red is reserved for rejection.
  const diverged = slot === OUTCOME_ACQUIRED;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: 12,
        borderRadius: "var(--radius-sm)",
        background: diverged ? DIVERGENCE_BG : "var(--color-neutral-900)",
        border: `1px solid ${diverged ? DIVERGENCE_BORDER : "var(--color-divider)"}`,
        minWidth: 0,
      }}
    >
      {loading ? (
        <Shimmer w={22} h={16} />
      ) : (
        <span
          style={{
            fontSize: 19,
            fontWeight: 600,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            color: diverged ? DIVERGENCE_FG : "inherit",
          }}
        >
          {count}
        </span>
      )}
      <span
        style={{
          fontSize: 11,
          lineHeight: 1.3,
          color: "color-mix(in srgb, var(--color-text) 58%, transparent)",
        }}
      >
        {outcomeLabel(slot)}
      </span>
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function Home(): React.ReactElement {
  // One server-computed summary instead of every firm, finding and drift row.
  const { data, isLoading, error } = useOsdkQuery<HomeSummary>("homeSummary");

  const inbox = React.useMemo(() => (data?.needsYou ?? []).map(toInboxItem), [data]);
  const inboxTotal = data?.needsYouTotal ?? 0;
  const counts = data?.needsYouCounts;
  // "+N more" points at whichever destination owns the most hidden rows.
  const overflowDestination = React.useMemo<Destination>(() => {
    const hidden: Record<Destination, number> = { review: 0, desk: 0, rules: 0 };
    for (const d of Object.keys(hidden) as Destination[]) {
      hidden[d] =
        (data?.needsYouCounts[d] ?? 0) -
        (data?.needsYou ?? []).filter((i) => i.destination === d).length;
    }
    return (Object.keys(hidden) as Destination[]).reduce((best, k) =>
      hidden[k] > hidden[best] ? k : best,
    );
  }, [data]);

  const trust = data?.trust;
  const decided = trust?.decidedFindings ?? 0;
  const trustReady = decided >= INSUFFICIENT_THRESHOLD;
  const passed = trust?.passed ?? 0;
  const passedAndAcquired = trust?.passedAndAcquired ?? 0;

  const headline = isLoading
    ? "Reading the ontology…"
    : inboxTotal === 0
      ? "Nothing needs you. Queue is clear."
      : `${inboxTotal} thing${inboxTotal === 1 ? "" : "s"} need${
          inboxTotal === 1 ? "s" : ""
        } you · every number below opens where the work happens`;

  const anyError = error;

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
        <BrandMark section="Home" />
        <WorkspaceNavLinks />
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 24px",
            borderBottom: "1px solid var(--color-divider)",
            height: 56,
            flex: "0 0 56px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
            <span style={{ fontWeight: 500, fontSize: 16 }}>Home</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {headline}
            </span>
          </div>
        </header>

        {anyError && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(207,112,112,.12)",
              color: "#e79191",
              fontSize: 12,
            }}
          >
            {String(anyError)}
          </div>
        )}

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 26px 26px",
            display: "grid",
            // Operational spine ~62% · trust rail ~38%.
            gridTemplateColumns: "minmax(0, 1.63fr) minmax(0, 1fr)",
            gap: 24,
            // Sections keep their natural height — stretching them to fill
            // the viewport opens voids inside the panels, which reads far
            // worse than a page that simply ends. The rail is the one
            // exception: `stretch` makes it match the spine's height so the
            // two columns bottom-align and the causal line lands on the
            // page's floor.
            alignItems: "stretch",
            alignContent: "start",
            minWidth: 0,
          }}
        >
          {/* ── Left: operational spine ──────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {/* Needs you — unified triage inbox */}
            <section style={{ minWidth: 0 }}>
              <SectionHead
                title={
                  <>
                    Needs you{" "}
                    <span
                      style={{ color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}
                    >
                      ({isLoading ? "…" : inboxTotal})
                    </span>
                  </>
                }
                href="/review"
                linkLabel="Open review"
              />
              <div
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-divider)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                {isLoading && (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                    }}
                  >
                    Loading open work…
                  </div>
                )}

                {inbox.map((item, i) => (
                  <InboxRow
                    key={item.key}
                    item={item}
                    last={i === inbox.length - 1 && inboxTotal <= inbox.length}
                  />
                ))}

                {inboxTotal > inbox.length && (
                  <Link
                    to={DESTINATION_PATH[overflowDestination]}
                    className="home-row"
                    style={{
                      display: "block",
                      padding: "8px 13px",
                      fontSize: 12,
                      color: "var(--color-accent)",
                      textDecoration: "none",
                      borderTop: "1px solid var(--color-divider)",
                    }}
                  >
                    +{inboxTotal - inbox.length} more →
                  </Link>
                )}

                {/* Zero-states: one quiet line per empty type, pinned to the
                    stack's foot so they read as a footnote to the work
                    above rather than competing with it. */}
                {counts !== undefined && (
                  <div>
                    {counts.review === 0 && (
                      <QuietLine>No open review entries. No passed firm has moved.</QuietLine>
                    )}
                    {counts.desk === 0 && (
                      <QuietLine>No abstentions in the queue. Every axis has a source.</QuietLine>
                    )}
                    {counts.rules === 0 && (
                      <QuietLine>
                        No pending rules. A rule drafts itself after ~5 similar rejections.
                      </QuietLine>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Active mandates */}
            <section style={{ minWidth: 0 }}>
              <SectionHead title="Active mandates" href="/mandate" linkLabel="All mandates" />
              <div
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-divider)",
                  background: "var(--color-surface)",
                  overflow: "hidden",
                }}
              >
                {isLoading && (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    Loading mandates…
                  </div>
                )}
                {data !== undefined && data.mandates.length === 0 && (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 12,
                      color: "color-mix(in srgb, var(--color-text) 52%, transparent)",
                      borderBottom: "1px solid var(--color-divider)",
                    }}
                  >
                    No active mandates. Nothing is feeding the queue.
                  </div>
                )}
                {(data?.mandates ?? []).map((m) => (
                  <MandateRow key={m.mandateId} mandate={m} />
                ))}
                {/* Ghost row — the way a new mandate starts. */}
                <Link
                  to="/mandate"
                  className="home-row"
                  style={{
                    display: "block",
                    padding: 12,
                    fontSize: 12,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                    textDecoration: "none",
                  }}
                >
                  + New mandate →
                </Link>
              </div>
            </section>

            {/* Funnel */}
            <section style={{ minWidth: 0 }}>
              <SectionHead title="Pipeline" href="/pipeline" linkLabel="Open pipeline" />
              <FunnelStrip counts={data?.funnel} />
            </section>
          </div>

          {/* ── Right: trust rail ────────────────────────────────── */}
          <section style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <SectionHead title="Trust" href="/accuracy" linkLabel="Open accuracy" />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 16,
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-divider)",
                minHeight: 0,
              }}
            >
              {trustReady ? (
                <>
                  <Link
                    to="/accuracy"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.2 }}>
                      Abstention rate: <span>{trust?.abstentionRate}%</span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                        marginTop: 4,
                      }}
                    >
                      Share of decided findings where no source had a value and Beacon recorded that
                      instead of guessing.
                    </div>
                  </Link>

                  <Link
                    className="home-quiet-link"
                    to="/accuracy"
                    style={{
                      fontSize: 13,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      borderTop: "1px solid var(--color-divider)",
                      paddingTop: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--color-text)",
                      }}
                    >
                      {trust?.agreementRate ?? "—"}
                      {trust?.agreementRate != null && "%"}
                    </span>
                    <span>
                      agreement across {decided} decided finding
                      {decided === 1 ? "" : "s"}
                    </span>
                  </Link>
                </>
              ) : (
                <Link
                  to="/accuracy"
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.3 }}>
                    Trust metrics appear after {INSUFFICIENT_THRESHOLD} decided findings
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                      marginTop: 4,
                    }}
                  >
                    {isLoading
                      ? "Counting decided findings…"
                      : `${decided} decided so far. Keep reviewing.`}
                  </div>
                </Link>
              )}

              <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
                <Kicker style={{ marginBottom: 8 }}>Observed outcomes</Kicker>
                <Link
                  to="/accuracy"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {OUTCOME_SLOTS.filter((s): s is string => s !== null).map((slot) => (
                    <OutcomeCell
                      key={slot}
                      slot={slot}
                      count={trust?.outcomes[slot] ?? 0}
                      loading={isLoading}
                    />
                  ))}
                </Link>
              </div>

              {/* The causal line — why any of the above matters. Pinned to
                  the rail's foot so the trust column reads top-down as
                  measurement → observation → consequence. */}
              {!isLoading && passed > 0 && (
                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: 12,
                    borderTop: "1px solid var(--color-divider)",
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                  }}
                >
                  Of firms we passed,{" "}
                  <strong style={{ color: DIVERGENCE_FG, fontWeight: 600 }}>
                    {passedAndAcquired}
                  </strong>{" "}
                  {passedAndAcquired === 1 ? "was" : "were"} later acquired.{" "}
                  <Link to="/review" style={{ color: "var(--color-accent)" }}>
                    The review loop exists to catch these →
                  </Link>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default Home;
