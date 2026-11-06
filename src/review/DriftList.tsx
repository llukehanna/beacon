import React from "react";
import { SectionHead } from "@/home/SectionHead";
import { EmptyState, Panel, Skeleton } from "@/ui";
import styles from "./DriftList.module.css";
import { type DriftRowModel } from "./driftModel";

function DriftRow({
  row,
  selected,
  tabbable,
  tourAnchor,
  onSelect,
  onKeyDown,
}: {
  row: DriftRowModel;
  selected: boolean;
  tabbable: boolean;
  /** The guided tour points here: the first open event, which stays short however long the queue grows. */
  tourAnchor: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}): React.ReactElement {
  return (
    <li className={styles.item} data-tour={tourAnchor ? "drift-list" : undefined}>
      <button
        type="button"
        className={styles.row}
        data-drift={row.id}
        data-selected={selected || undefined}
        data-resolved={row.resolved || undefined}
        aria-pressed={selected}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onSelect(row.id)}
        onKeyDown={onKeyDown}
      >
        <span className={`${styles.mark} ${styles[row.tone]}`} aria-hidden="true">
          {row.mark}
        </span>
        <span className={styles.text}>
          <b>{row.name}</b>
          <span className={styles.reason}>{row.reason}</span>
        </span>
        <span className={styles.figure}>
          {row.resolution !== null ? (
            <span className={styles.resolution}>{row.resolution}</span>
          ) : (
            row.figure !== null && (
              <>
                {row.figure.from}{" "}
                <i
                  className={
                    row.moved === "up"
                      ? styles.gain
                      : row.moved === "down"
                        ? styles.loss
                        : undefined
                  }
                >
                  → {row.figure.to}
                </i>
              </>
            )
          )}
        </span>
        <span className={styles.age}>{row.age}</span>
      </button>
    </li>
  );
}

/**
 * The drift events as rows in the Needs-you style: a mark for the kind of drift, the firm and why
 * it surfaced, the tier change and its age. Open events in one panel, resolved ones in another.
 * One row holds the tab stop; the arrow keys move between rows.
 */
export function DriftList({
  open,
  resolved,
  selectedId,
  onSelect,
  loading,
}: {
  open: readonly DriftRowModel[];
  resolved: readonly DriftRowModel[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** True while the drift events load. */
  loading: boolean;
}): React.ReactElement {
  const listRef = React.useRef<HTMLDivElement>(null);
  const all = [...open, ...resolved];
  const tabStop = all.find((r) => r.id === selectedId)?.id ?? all[0]?.id;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-drift]") ?? [],
    );
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    const target =
      e.key === "ArrowDown"
        ? Math.min(buttons.length - 1, at + 1)
        : e.key === "ArrowUp"
          ? Math.max(0, at - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : null;
    if (target !== null) {
      e.preventDefault();
      buttons[target].focus();
    }
  };

  const renderRows = (rows: readonly DriftRowModel[], anchorFirst = false): React.ReactElement => (
    <ul className={styles.list}>
      {rows.map((r, i) => (
        <DriftRow
          key={r.id}
          row={r}
          selected={r.id === selectedId}
          tabbable={r.id === tabStop}
          tourAnchor={anchorFirst && i === 0}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
        />
      ))}
    </ul>
  );

  return (
    <div className={styles.queue} ref={listRef}>
      <Panel
        className={styles.panel}
        aria-label="Needs review"
        data-tour={!loading && open.length === 0 ? "drift-list" : undefined}
      >
        <SectionHead title="Needs review" count={loading ? undefined : open.length} />
        {loading && (
          <div className={styles.pad}>
            <Skeleton lines={4} />
          </div>
        )}
        {!loading && open.length === 0 && (
          <div className={styles.pad}>
            <EmptyState
              title="Nothing waiting on you"
              body="Every drift event has a decision. Resolved ones are listed below."
            />
          </div>
        )}
        {renderRows(open, true)}
      </Panel>
      {resolved.length > 0 && (
        <Panel className={styles.panel} aria-label="Resolved">
          <SectionHead title="Resolved" count={resolved.length} />
          {renderRows(resolved)}
        </Panel>
      )}
    </div>
  );
}
