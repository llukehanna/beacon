import React from "react";
import { Link } from "react-router-dom";
import { type ScreeningRule, isLiveQueueFirm, screenFirm } from "../activeScreening";
import { isOpenFirm } from "../pipelineBuckets";
import { type RankedFirm } from "../queue";
import { formatScore, queueRowTier, scoreFraction } from "../scoreFormat";
import { TIER_COLOR } from "../tokens";
import { TierTag } from "./FirmHeader";
import { Kicker } from "./chips";
import { type RediscoveryInfo } from "./deskModel";

// Compact per-firm rediscovery badge for the queue row. "new" = firm was
// created by the current search; "rediscovered" = firm already existed
// and was attached (dedupe hit), with N prior decisions in the ontology.
function RediscoveryBadge({ info }: { info: RediscoveryInfo }): React.ReactElement {
  const isNew = info.kind === "new";
  const label = isNew
    ? "new"
    : info.priorDecisions === 0
      ? "in DB"
      : `in DB · ${info.priorDecisions} prior`;
  const title = isNew
    ? "Newly discovered by this search"
    : info.priorDecisions === 0
      ? "Already in the database, no prior decisions on file"
      : `Already in the database — ${info.priorDecisions} prior decision${
          info.priorDecisions === 1 ? "" : "s"
        }`;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: "var(--radius-sm)",
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: isNew ? "#8ee5c0" : "#c9a9f7",
        background: isNew ? "rgba(79,209,154,.18)" : "rgba(155,127,224,.16)",
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      {label}
    </span>
  );
}

// Top strip on the enrichment desk when the queue is pinned to a Search.
// Reads intent statement, search name / #N, and total member count. The
// "clear" pill drops ?search from the URL, restoring the master queue.
export function SearchFilterBar({
  intentText,
  searchName,
  searchIndex,
  memberCount,
  loading,
  onClear,
}: {
  intentText: string;
  searchName?: string | null;
  // 1-based rank of this search under the mandate (freshest = 1). Used
  // when the search has no human-readable name — reads as "Search #2".
  searchIndex?: number;
  memberCount: number;
  loading: boolean;
  onClear: () => void;
}): React.ReactElement {
  const label = (searchName ?? "").trim() || (searchIndex ? `Search #${searchIndex}` : "Search");
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid var(--color-divider)",
        background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        fontSize: 12,
        color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-accent)",
          fontWeight: 600,
        }}
      >
        Filtered
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          flex: 1,
        }}
        title={intentText}
      >
        <strong style={{ fontWeight: 600 }}>Mandate:</strong> {intentText || "—"}
        <span
          style={{
            color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            margin: "0 6px",
          }}
        >
          ·
        </span>
        {label}
        <span
          style={{
            color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            margin: "0 6px",
          }}
        >
          ·
        </span>
        {loading ? "loading firms…" : `${memberCount} firm${memberCount === 1 ? "" : "s"}`}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: "3px 10px" }}
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  );
}

export function QueueSidebar({
  queue,
  isLoading,
  selectedId,
  onSelect,
  screeningRules,
  scopeLabel,
  membershipPinned,
  rediscoveryByFirmId,
}: {
  queue: RankedFirm[];
  isLoading: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  // Approved rules, already resolved to their effective predicates. Drive
  // both the live-queue partition and the per-row "screened · <rule>" chip.
  screeningRules: readonly ScreeningRule[];
  // "in database" normally; "in search" when a Search pins the desk, so the
  // middle term never claims to describe the whole database while the view
  // is scoped to one search's members.
  scopeLabel: string;
  // True when a search / mandate membership chip scopes the desk. Like the
  // search box, an explicit "show me this set" action bypasses the live-queue
  // narrowing — an analyst reviewing what a search returned needs to see the
  // screened members too, chip and all, not a silently shortened list.
  membershipPinned: boolean;
  // Populated only when the desk is filtered by a Search. Missing entries
  // render no badge — the queue row degrades to its normal appearance.
  rediscoveryByFirmId?: Map<string, RediscoveryInfo>;
}): React.ReactElement {
  const [q, setQ] = React.useState("");
  // Default view is the live queue. The toggle reveals decided and screened
  // firms; it does not change what the search box can reach.
  const [showAll, setShowAll] = React.useState(false);
  const searching = q.trim() !== "";

  // Per-firm screening verdict, computed once for the whole queue and reused
  // by the partition, the counts, and the chip — one evaluation, so a row's
  // chip can't contradict the header that counted it.
  const screenByFirmId = React.useMemo(() => {
    const m = new Map<string, ScreeningRule>();
    for (const r of queue) {
      const res = screenFirm(r.firm as never, screeningRules);
      if (res.screened && res.rule !== null) {
        m.set(r.firm.firmId, res.rule);
      }
    }
    return m;
  }, [queue, screeningRules]);

  // Open per the funnel — isOpenFirm, the same derivation /pipeline and
  // Home's strip use — so "N open" here equals Discovered + Screening there.
  // Everything else in the header is computed against that base, so
  // live + openScreened === open, and open ⊆ database.
  const openByFirmId = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of queue) {
      if (isOpenFirm(r.firm, r.hardRejected)) {
        s.add(r.firm.firmId);
      }
    }
    return s;
  }, [queue]);

  const { liveCount, openCount, openScreenedCount } = React.useMemo(() => {
    let openScreened = 0;
    for (const firmId of openByFirmId) {
      if (screenByFirmId.has(firmId)) {
        openScreened++;
      }
    }
    const open = openByFirmId.size;
    return { liveCount: open - openScreened, openCount: open, openScreenedCount: openScreened };
  }, [openByFirmId, screenByFirmId]);

  const filtered = React.useMemo(() => {
    // The search box reaches every firm in scope regardless of the toggle —
    // an analyst looking up a firm by name should never have to know it was
    // screened or already decided to find it.
    const base =
      searching || showAll || membershipPinned
        ? queue
        : queue.filter((r) =>
            // Same predicate the header counts, so the list length and the
            // "N in live queue" figure above it can never disagree.
            isLiveQueueFirm(r.firm as never, screeningRules, openByFirmId.has(r.firm.firmId)),
          );
    if (!searching) {
      return base;
    }
    const needle = q.trim().toLowerCase();
    return base.filter(
      (r) =>
        (r.firm.firmName ?? "").toLowerCase().includes(needle) ||
        (r.firm.firmId ?? "").toLowerCase().includes(needle),
    );
  }, [queue, q, searching, showAll, membershipPinned, screeningRules, openByFirmId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
      <div
        style={{
          padding: "0 4px",
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Kicker>Queue</Kicker>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
          }}
        >
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            style={{ accentColor: "var(--color-accent)", cursor: "pointer" }}
          />
          Show all firms
        </label>
      </div>

      {/* Search */}
      <div style={{ position: "relative" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search firms…"
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

      {/* Queue arithmetic. Every number here is computed from the same firm
          set and the same approved rules /rules screens on, so the desk and
          the rule cards can no longer disagree about how many firms a rule
          takes off the desk. */}
      <div
        style={{
          fontSize: 10,
          lineHeight: 1.5,
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          padding: "0 4px",
        }}
      >
        {isLoading && queue.length === 0 ? (
          "Loading…"
        ) : (
          <>
            <strong style={{ color: "var(--color-text)", fontWeight: 600 }}>{liveCount}</strong> in
            live queue{" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{openCount}</span> open{" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{queue.length}</span> {scopeLabel}
            {": "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{openScreenedCount}</span> open
            firm{openScreenedCount === 1 ? "" : "s"} screened by{" "}
            <Link to="/rules" style={{ color: "var(--color-accent)" }}>
              approved rules
            </Link>
            {" · "}sorted by expected gain
          </>
        )}
      </div>

      {/* Only shown when the view is narrower or wider than the header's
          headline number, so the list count is never ambiguous. */}
      {!isLoading && (searching || showAll || membershipPinned) && (
        <div
          style={{
            fontSize: 10,
            padding: "0 4px",
            marginTop: -6,
            color: "color-mix(in srgb, var(--color-text) 40%, transparent)",
          }}
        >
          {searching
            ? `${filtered.length} matching · searching all firms`
            : membershipPinned
              ? `showing all ${filtered.length} in this search`
              : `showing all ${filtered.length}`}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minHeight: 0,
        }}
      >
        {isLoading && queue.length === 0 && (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            Loading firms…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            {q === "" ? "No firms in the queue." : "No firms match that search."}
          </div>
        )}
        {filtered.map((r) => {
          const selected = r.firm.firmId === selectedId;
          // A firm an approved rule screened out wears an R; every other
          // firm shows its own score tier, the same as the header and Pipeline.
          const displayTier = queueRowTier(r.hardScreened, r.tier);
          const barFill = r.hardScreened ? 0 : scoreFraction(r.currentScore);
          // An approved rule took this firm off the live queue. Named, not
          // just dimmed — "why is this firm greyed out" should be readable
          // from the row without opening it.
          const screenedBy = screenByFirmId.get(r.firm.firmId) ?? null;
          const dimmed = r.hardScreened || screenedBy !== null;
          return (
            <button
              key={r.firm.firmId}
              onClick={() => onSelect(r.firm.firmId)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 4,
                width: "100%",
                textAlign: "left",
                padding: "8px 8px",
                border: "1px solid transparent",
                borderColor: selected ? "var(--color-accent)" : "transparent",
                borderRadius: "var(--radius-chip)",
                cursor: "pointer",
                background: selected
                  ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                  : "transparent",
                color: "inherit",
                font: "inherit",
                opacity: dimmed ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  fontWeight: 500,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    textDecorationLine: dimmed ? "line-through" : "none",
                    textDecorationColor: "color-mix(in srgb, var(--color-text) 40%, transparent)",
                  }}
                >
                  {r.firm.firmName ?? r.firm.firmId}
                </span>
                {(() => {
                  const info = rediscoveryByFirmId?.get(r.firm.firmId ?? "");
                  return info ? <RediscoveryBadge info={info} /> : null;
                })()}
              </span>
              <TierTag tier={displayTier} />
              <div
                style={{
                  gridColumn: "1 / 3",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 10,
                  color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                }}
              >
                {screenedBy !== null ? (
                  <span
                    title={`Screened by an approved rule: ${screenedBy.label}`}
                    style={{
                      padding: "1px 6px",
                      borderRadius: "var(--radius-sm)",
                      background: "color-mix(in srgb, var(--color-text) 8%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--color-text) 12%, transparent)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    screened · {screenedBy.label}
                  </span>
                ) : r.hardScreened ? (
                  <span title={r.hardScreenReason ?? undefined}>
                    hard-screened{r.hardScreenReason ? ` · ${r.hardScreenReason}` : ""}
                  </span>
                ) : (
                  <>
                    <span
                      style={{ fontVariantNumeric: "tabular-nums" }}
                      title={`${formatScore(r.currentScore)} known → ${formatScore(r.ceiling)} reachable if the remaining fields were filled`}
                    >
                      {formatScore(r.currentScore)} → {formatScore(r.ceiling)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: "var(--radius-xs)",
                        background: "var(--color-neutral-800)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `calc(100% * ${barFill})`,
                          background: TIER_COLOR[r.tier] ?? "var(--color-neutral-500)",
                        }}
                      />
                    </span>
                    <span
                      title="Rubric axes with no value yet"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {r.missingCount} missing
                    </span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
