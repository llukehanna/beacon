import React from "react";
import { hqCode } from "@/desk/pipelineRows";
import { Chip } from "@/ui";
import styles from "./FirmCards.module.css";
import { FitCell } from "./FitCell";
import { StageChip } from "./chips";
import { type Row, activityText, isOut } from "./pipelineModel";
import { useWindowedRows } from "./useWindowedRows";

/** Card height plus the gap under it: the list is windowed, so every card takes exactly this. */
export const CARD_PITCH = 112;

function FirmCard({
  row,
  index,
  selected,
  tabbable,
  now,
  onSelect,
  onKeyDown,
}: {
  row: Row;
  index: number;
  selected: boolean;
  tabbable: boolean;
  now: number;
  onSelect: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>) => void;
}): React.ReactElement {
  const { firm, bucket, lastActivity } = row;
  const name = firm.firmName ?? firm.firmId ?? "";
  const where = [firm.sector, firm.hqCountry ? hqCode(firm.hqCountry) : null].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
  return (
    <li
      className={styles.card}
      role="option"
      data-index={index}
      aria-selected={selected}
      data-selected={selected || undefined}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => {
        if (firm.firmId) {
          onSelect(firm.firmId);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.top}>
        <span className={styles.name} data-out={isOut(row) || undefined} title={name}>
          {name}
        </span>
        <StageChip stage={bucket} />
      </div>
      <div className={styles.meta}>
        {firm.firmType && <Chip>{firm.firmType}</Chip>}
        <span className={styles.where}>{where.join(" · ")}</span>
        {firm.employees !== null && firm.employees !== undefined && (
          <span className={styles.staff}>{firm.employees} staff</span>
        )}
      </div>
      <div className={styles.bottom}>
        <FitCell row={row} />
        <span className={styles.activity}>{activityText(lastActivity, now)}</span>
      </div>
    </li>
  );
}

/** The firms as a list of cards, for screens under 900 px. Windowed like the table. */
export function FirmCards({
  rows,
  selectedId,
  onSelect,
  scrollRef,
  now,
}: {
  rows: readonly Row[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  scrollRef: React.RefObject<HTMLElement>;
  now: number;
}): React.ReactElement {
  const win = useWindowedRows<HTMLUListElement>({
    rows,
    selectedId,
    onSelect,
    scrollRef,
    rowHeight: CARD_PITCH,
    headerHeight: 0,
  });
  return (
    <ul
      ref={win.listRef}
      className={styles.list}
      role="listbox"
      aria-label="Firms"
      onFocus={win.onFocus}
      onBlur={win.onBlur}
    >
      {win.segments.map((seg, i) => {
        if (seg.kind === "spacer") {
          return (
            <li
              key={`spacer-${i}`}
              role="presentation"
              aria-hidden="true"
              style={{ height: seg.rows * CARD_PITCH }}
            />
          );
        }
        const r = rows[seg.index];
        return (
          <FirmCard
            key={r.firm.firmId ?? `row-${seg.index}`}
            row={r}
            index={seg.index}
            selected={r.firm.firmId === selectedId}
            tabbable={seg.index === win.tabIndexRow}
            now={now}
            onSelect={onSelect}
            onKeyDown={win.onKeyDown}
          />
        );
      })}
    </ul>
  );
}
