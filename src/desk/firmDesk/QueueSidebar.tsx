import React from "react";
import { Link } from "react-router-dom";
import { Search } from "@blueprintjs/icons";
import { AGENT } from "../../../shared/vocab";
import { type ScreeningRule, isLiveQueueFirm, screenFirm } from "../activeScreening";
import { isOpenFirm } from "../pipelineBuckets";
import { type RankedFirm } from "../queue";
import { formatScore, scoreFraction } from "../scoreFormat";
import styles from "./QueueSidebar.module.css";
import { type RediscoveryInfo } from "./deskModel";
import { type FindingCounts, queueStateLine } from "./queueState";

/** What the queue knows about a firm's last enrichment, for the row's state line. */
export interface QueueRun {
  enrichedAt: string | null;
  enrichedBy: string | null;
}

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
    <span title={title} className={`${styles.badge} ${isNew ? styles.badgeNew : styles.badgeSeen}`}>
      {label}
    </span>
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
  query,
  onQueryChange,
  showAll,
  onShowAllChange,
  runByFirmId,
  countsByFirmId,
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
  query: string;
  onQueryChange: (q: string) => void;
  // Default view is the live queue. The switch reveals decided and screened
  // firms; it does not change what the search box can reach.
  showAll: boolean;
  onShowAllChange: (on: boolean) => void;
  runByFirmId: ReadonlyMap<string, QueueRun>;
  countsByFirmId: ReadonlyMap<string, FindingCounts>;
}): React.ReactElement {
  const searching = query.trim() !== "";

  // Per-firm screening verdict, computed once for the whole queue and reused
  // by the partition, the counts, and the chip — one evaluation, so a row's
  // chip can't contradict the header that counted it.
  const screenByFirmId = React.useMemo(() => {
    const m = new Map<string, ScreeningRule>();
    for (const r of queue) {
      const res = screenFirm(r.firm, screeningRules);
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
    // The search box reaches every firm in scope regardless of the switch —
    // an analyst looking up a firm by name should never have to know it was
    // screened or already decided to find it.
    const base =
      searching || showAll || membershipPinned
        ? queue
        : queue.filter((r) =>
            // Same predicate the header counts, so the list length and the
            // "N in live queue" figure above it can never disagree.
            isLiveQueueFirm(r.firm, screeningRules, openByFirmId.has(r.firm.firmId)),
          );
    if (!searching) {
      return base;
    }
    const needle = query.trim().toLowerCase();
    return base.filter(
      (r) =>
        (r.firm.firmName ?? "").toLowerCase().includes(needle) ||
        (r.firm.firmId ?? "").toLowerCase().includes(needle),
    );
  }, [queue, query, searching, showAll, membershipPinned, screeningRules, openByFirmId]);

  // Roving tabindex: one row is in the tab order (the open firm, else the one last focused, else
  // the first), so Tab enters the list once and arrow keys move within it.
  const listRef = React.useRef<HTMLUListElement>(null);
  const [activeId, setActiveId] = React.useState<string | undefined>(selectedId);
  React.useEffect(() => setActiveId(selectedId), [selectedId]);
  const tabId = filtered.some((r) => r.firm.firmId === activeId)
    ? activeId
    : (filtered.find((r) => r.firm.firmId === selectedId) ?? filtered[0])?.firm.firmId;

  const rows = (): HTMLButtonElement[] =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-row]") ?? []);

  const focusRow = (index: number): void => {
    const row = rows()[Math.max(0, Math.min(filtered.length - 1, index))];
    if (row !== undefined) {
      row.focus();
    }
  };

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const current = rows().indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (e.key) {
      case "ArrowDown":
        next = current + 1;
        break;
      case "ArrowUp":
        next = current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = filtered.length - 1;
        break;
      default:
        return;
    }
    // Keep the desk's own arrow-key handling (axis focus) from also seeing this keystroke.
    e.preventDefault();
    e.stopPropagation();
    focusRow(next);
  };

  // Bring the open firm into view, including when the sidebar remounts with it far down the list.
  React.useEffect(() => {
    const open = rows().find((b) => b.dataset.row === selectedId);
    open?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  const now = Date.now();

  return (
    <div className={styles.queue}>
      <div className={styles.head}>
        <span className={styles.title}>Queue</span>
        <span
          className={styles.order}
          title="Sorted by the points a firm could still gain if its missing fields were filled: the +N beside each score. Ties go to the firm with fewer fields missing, then A to Z."
        >
          most points to gain first
        </span>
      </div>

      <div className={styles.search}>
        <Search size={13} className={styles.searchIcon} aria-hidden="true" />
        <input
          className={styles.input}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && filtered.length > 0) {
              e.preventDefault();
              focusRow(
                Math.max(
                  0,
                  filtered.findIndex((r) => r.firm.firmId === tabId),
                ),
              );
            }
          }}
          placeholder="Search firms…"
          aria-label="Search firms"
        />
      </div>

      <label className={styles.showAll}>
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => onShowAllChange(e.target.checked)}
        />
        Show all firms
      </label>

      {/* Queue arithmetic. Every number here is computed from the same firm
          set and the same approved rules /rules screens on, so the desk and
          the rule cards can no longer disagree about how many firms a rule
          takes off the desk. */}
      <div className={styles.summary}>
        {isLoading && queue.length === 0 ? (
          "Loading…"
        ) : (
          <>
            <strong>{liveCount}</strong> in live queue{" · "}
            <span className={styles.num}>{openCount}</span> open{" · "}
            <span className={styles.num}>{queue.length}</span> {scopeLabel}
            <div>
              <span className={styles.num}>{openScreenedCount}</span> open firm
              {openScreenedCount === 1 ? "" : "s"} screened by{" "}
              <Link to="/rules" className={styles.link}>
                approved rules
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Only shown when the view is narrower or wider than the headline number, so the list
          count is never ambiguous. */}
      {!isLoading && (searching || showAll || membershipPinned) && (
        <div className={styles.note}>
          {searching
            ? `${filtered.length} matching · searching all firms`
            : membershipPinned
              ? `showing all ${filtered.length} in this search`
              : `showing all ${filtered.length}`}
        </div>
      )}

      <div className={styles.scroll}>
        {isLoading && queue.length === 0 && <div className={styles.empty}>Loading firms…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className={styles.empty}>
            {query === "" ? "No firms in the queue." : "No firms match that search."}
          </div>
        )}
        <ul ref={listRef} className={styles.list} aria-label="Firms in the queue">
          {filtered.map((r) => {
            const id = r.firm.firmId;
            const selected = id === selectedId;
            // A firm an approved rule screened out reads R; every other firm shows its score.
            const rejected = r.hardScreened;
            const barFill = r.hardScreened ? 0 : scoreFraction(r.currentScore);
            const barCeiling = r.hardScreened ? 0 : scoreFraction(r.ceiling);
            // An approved rule took this firm off the live queue. Named, not
            // just dimmed — "why is this firm greyed out" should be readable
            // from the row without opening it.
            const screenedBy = screenByFirmId.get(id) ?? null;
            const dimmed = r.hardScreened || screenedBy !== null;
            const run = runByFirmId.get(id);
            const info = rediscoveryByFirmId?.get(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  data-row={id}
                  className={`${styles.row} ${selected ? styles.on : ""} ${dimmed ? styles.dim : ""}`}
                  tabIndex={id === tabId ? 0 : -1}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(id)}
                  onFocus={() => setActiveId(id)}
                  onKeyDown={onRowKeyDown}
                >
                  <span className={styles.name}>
                    <span className={styles.nameText}>{r.firm.firmName ?? id}</span>
                    {info && <RediscoveryBadge info={info} />}
                  </span>
                  <span
                    className={styles.score}
                    title={
                      rejected
                        ? "Screened out"
                        : `${formatScore(r.currentScore)} known → ${formatScore(r.ceiling)} reachable if the remaining fields were filled · ${r.missingCount} rubric axes with no value yet`
                    }
                  >
                    {rejected ? "R" : r.currentScore}
                    {!rejected && r.gain > 0 && (
                      <span className={styles.gain} title={`Up to +${r.gain} points if enriched`}>
                        {" "}
                        +{r.gain}
                      </span>
                    )}
                  </span>
                  <span className={styles.bar} aria-hidden="true">
                    <i className={styles.ceiling} style={{ width: `${barCeiling * 100}%` }} />
                    <i className={styles.fill} style={{ width: `${barFill * 100}%` }} />
                  </span>
                  <small className={styles.state}>
                    {screenedBy !== null ? (
                      <span title={`Screened by an approved rule: ${screenedBy.label}`}>
                        Screened · {screenedBy.label}
                      </span>
                    ) : r.hardScreened ? (
                      <span title={r.hardScreenReason ?? undefined}>
                        Hard-screened{r.hardScreenReason ? ` · ${r.hardScreenReason}` : ""}
                      </span>
                    ) : (
                      queueStateLine({
                        enrichedAt: run?.enrichedAt,
                        enrichedBy: run?.enrichedBy,
                        agent: AGENT,
                        counts: countsByFirmId.get(id),
                        now,
                      })
                    )}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
