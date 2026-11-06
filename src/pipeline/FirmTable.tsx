import React from "react";
import {
  type PipelineSort,
  type PipelineSortKey,
  type SortDirection,
  hqCode,
  sortDirection,
} from "@/desk/pipelineRows";
import { Chip } from "@/ui";
import styles from "./FirmTable.module.css";
import { FitCell } from "./FitCell";
import { StageChip } from "./chips";
import { type Row, activityText, isOut } from "./pipelineModel";
import { useWindowedRows } from "./useWindowedRows";

/** Fixed geometry: the body is windowed, so every row is exactly this tall. */
export const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 36;
const COLUMN_COUNT = 8;

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
    <th scope="col" aria-sort={isActive ? direction : "none"}>
      <button type="button" className={styles.sort} onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden="true" data-active={isActive || undefined}>
          {isActive && direction === "ascending" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}

function FirmRow({
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
  onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => void;
}): React.ReactElement {
  const { firm, bucket, lastActivity } = row;
  const name = firm.firmName ?? firm.firmId ?? "";
  const activity = activityText(lastActivity, now);
  return (
    <tr
      className={styles.row}
      data-index={index}
      data-selected={selected || undefined}
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      style={{ height: ROW_HEIGHT }}
      onClick={() => {
        if (firm.firmId) {
          onSelect(firm.firmId);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <td className={styles.firm}>
        <div className={styles.name} data-out={isOut(row) || undefined} title={name}>
          {name}
        </div>
        {firm.coverageModel && (
          <div className={styles.sub} title={firm.coverageModel}>
            {firm.coverageModel}
          </div>
        )}
      </td>
      <td className={styles.colType}>{firm.firmType && <Chip>{firm.firmType}</Chip>}</td>
      <td className={`${styles.sector} ${styles.colSector}`} title={firm.sector ?? undefined}>
        {firm.sector || <span className={styles.none}>—</span>}
      </td>
      <td>
        <StageChip stage={bucket} />
      </td>
      <td>
        <FitCell row={row} />
      </td>
      <td className={styles.num}>{firm.employees ?? "—"}</td>
      <td className={styles.hq} title={firm.hqCountry || undefined}>
        {hqCode(firm.hqCountry)}
      </td>
      <td className={`${styles.activity} ${styles.colActivity}`} title={activity}>
        {activity}
      </td>
    </tr>
  );
}

/** The firms as a dense table, windowed so 700 rows stay cheap. Sort by Firm, Stage or Fit. */
export function FirmTable({
  rows,
  selectedId,
  onSelect,
  scrollRef,
  sort,
  onSort,
  now,
}: {
  rows: readonly Row[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  scrollRef: React.RefObject<HTMLElement>;
  sort: PipelineSort;
  onSort: (key: PipelineSortKey) => void;
  now: number;
}): React.ReactElement {
  const win = useWindowedRows<HTMLTableElement>({
    rows,
    selectedId,
    onSelect,
    scrollRef,
    rowHeight: ROW_HEIGHT,
    headerHeight: HEADER_HEIGHT,
  });
  const handleSort = (key: PipelineSortKey): void => {
    onSort(key);
    win.scrollToTop();
  };
  return (
    <div className={styles.wrap}>
      <table
        ref={win.listRef}
        className={styles.table}
        role="grid"
        aria-label="Firms"
        aria-rowcount={rows.length + 1}
      >
        {/* Fixed widths: Stage and Fit each own their cell, so a chip can't run into the next
            column, and Firm takes whatever width is left. */}
        <colgroup>
          <col />
          <col className={styles.colType} />
          <col className={styles.colSector} />
          <col />
          <col />
          <col />
          <col />
          <col className={styles.colActivity} />
        </colgroup>
        <thead>
          <tr aria-rowindex={1}>
            <SortHeader label="Firm" sortKey="name" sort={sort} onSort={handleSort} />
            <th scope="col" className={styles.colType}>
              Type
            </th>
            <th scope="col" className={styles.colSector}>
              Sector
            </th>
            <SortHeader label="Stage" sortKey="stage" sort={sort} onSort={handleSort} />
            <SortHeader label="Fit" sortKey="score" sort={sort} onSort={handleSort} />
            <th scope="col" className={styles.numHead}>
              Emp.
            </th>
            <th scope="col">HQ</th>
            <th scope="col" className={styles.colActivity}>
              Activity
            </th>
          </tr>
        </thead>
        <tbody onFocus={win.onFocus} onBlur={win.onBlur}>
          {win.segments.map((seg, i) => {
            if (seg.kind === "spacer") {
              return (
                <tr
                  key={`spacer-${i}`}
                  className={styles.spacer}
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
                tabbable={seg.index === win.tabIndexRow}
                now={now}
                onSelect={onSelect}
                onKeyDown={win.onKeyDown}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
