import React from "react";
import { ConfidenceBars, Skeleton, StatusPill } from "@/ui";
import { PROVIDER_TRUST, providerLabel } from "../../../shared/vocab";
import { formatAxisValue } from "../findingActions";
import styles from "./AxisGrid.module.css";
import {
  type AxisRow,
  type RowCounts,
  type RowState,
  compositionText,
  summaryText,
} from "./axisRows";
import { type EditMap } from "./deskModel";
import { rejectReasonText } from "./evidenceModel";
import { type OnFile } from "./onFile";

/** The pending value an analyst has staged for an axis, as the row shows it. */
function stagedText(row: AxisRow, edits: EditMap): string | null {
  const v = edits[row.def.actionParam];
  return v === undefined || v === "" ? null : formatAxisValue(row.def.actionParam, v);
}

/**
 * The on-file line under an axis name, for rows where the sources give the value no home. A staged
 * value gets the "pending" line instead, so it is never called "on file" before it is committed.
 */
function fileLine(row: AxisRow, file: OnFile | undefined, noteShowsIt: boolean): string | null {
  if (
    file === undefined ||
    file.pending ||
    noteShowsIt ||
    (row.state !== "empty" && row.state !== "rejected" && row.state !== "abstained")
  ) {
    return null;
  }
  return `on file: ${file.text}${file.band === null ? "" : ` · ${file.band}/2`}`;
}

function RowStatus({ state }: { state: RowState }): React.ReactElement {
  return state === "empty" ? (
    <span className={styles.none}>No finding</span>
  ) : (
    <StatusPill status={state} />
  );
}

function ProviderCell({ row, provider }: { row: AxisRow; provider: string }): React.ReactElement {
  const cell = row.cells[provider];
  const turnedDown = row.rejections.find((r) => r.provider === provider);
  const name = providerLabel(provider);
  if (cell.value !== null) {
    return (
      <span className={`${styles.val} ${row.def.kind === "enum" ? styles.words : ""}`}>
        <span className={styles.valText}>{cell.value}</span>
        <ConfidenceBars level={cell.confidence} />
      </span>
    );
  }
  if (turnedDown !== undefined) {
    return (
      <span
        className={styles.turnedDown}
        title={`${name} said ${turnedDown.value}. ${rejectReasonText(turnedDown.reason)}`}
      >
        <span className={styles.valText}>{turnedDown.value}</span>
        <span className={styles.turnedDownTag}>not grounded</span>
      </span>
    );
  }
  return (
    <span className={styles.nil} role="img" aria-label={`${name} had no value`}>
      ·
    </span>
  );
}

/**
 * The axis by source grid: a row per rubric axis, a column per provider showing what that
 * provider said, and a status showing what Beacon decided. Selecting a row fills the evidence
 * panel; the arrow keys move the selection.
 */
export function AxisGrid({
  rows,
  counts,
  edits,
  onFile,
  selected,
  onSelect,
  loading,
}: {
  rows: AxisRow[];
  counts: RowCounts;
  edits: EditMap;
  /** What the firm record holds per axis (see onFile.ts). */
  onFile: Record<string, OnFile>;
  selected: string | undefined;
  onSelect: (axis: string, provider?: string) => void;
  /** True while the findings load. */
  loading: boolean;
}): React.ReactElement {
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const tabStop = selected ?? rows[0]?.axis;

  // When the selection moves from one axis to another, the focus follows it if it was on a row,
  // and the row is brought into view. A first selection (the page opening on one) never scrolls.
  const before = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const moved = before.current !== undefined && selected !== undefined;
    before.current = selected;
    const body = tbodyRef.current;
    if (!moved || body === null) {
      return;
    }
    const target = body.querySelector<HTMLElement>(`tr[data-axis="${selected}"]`);
    if (target === null) {
      return;
    }
    if (body.contains(document.activeElement) && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
    target.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  if (loading) {
    return (
      <div className={styles.wrap} aria-busy="true" aria-label="Loading findings">
        <Skeleton height={39 * 6} />
      </div>
    );
  }
  const noFindings = rows.every((r) => r.state === "empty");

  return (
    <section className={styles.section} aria-label="Axes by source">
      <div className={styles.head}>
        <h2 className={styles.title}>Axes by source</h2>
        <span className={styles.summary}>{summaryText(counts)}</span>
      </div>
      <p className={styles.composition}>
        {compositionText(rows)} A gate is pass or fail and earns no points.
      </p>
      {noFindings && (
        <p className={styles.note} role="status">
          <strong>No findings yet.</strong> Run the agent from the strip above to query every
          source, or set a value yourself: select an axis to enter one.
        </p>
      )}
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Axis</th>
              <th scope="col">Weight</th>
              {PROVIDER_TRUST.map((p) => (
                <th scope="col" key={p}>
                  {providerLabel(p)}
                </th>
              ))}
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {rows.map((row) => {
              const staged = stagedText(row, edits);
              const noSource =
                row.state === "abstained" &&
                row.readings.length > 0 &&
                row.readings.every((r) => r.value === null);
              const isSelected = row.axis === selected;
              return (
                <tr
                  key={row.axis}
                  data-axis={row.axis}
                  data-state={row.state}
                  data-tour={row.state === "conflict" ? "conflict-row" : undefined}
                  data-selected={isSelected ? "true" : undefined}
                  aria-current={isSelected ? "true" : undefined}
                  tabIndex={row.axis === tabStop ? 0 : -1}
                  className={[
                    styles.row,
                    row.state === "conflict" ? styles.cf : "",
                    row.state === "abstained" ? styles.ab : "",
                    isSelected ? styles.sel : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelect(row.axis)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect(row.axis);
                    }
                  }}
                >
                  <th scope="row" className={styles.ax}>
                    <span className={styles.axName}>{row.label}</span>
                    {fileLine(row, onFile[row.axis], noSource) !== null && (
                      <span className={styles.onFile}>
                        {fileLine(row, onFile[row.axis], noSource)}
                      </span>
                    )}
                    {staged !== null && (
                      <span className={styles.pending} title={`Staged for commit: ${staged}`}>
                        pending: {staged}
                      </span>
                    )}
                  </th>
                  <td
                    className={styles.w}
                    title={
                      row.def.kind === "gate"
                        ? "A gate: pass or fail, no points"
                        : "A scored axis: 0 to 2 of the 18 points"
                    }
                  >
                    {row.weight}
                  </td>
                  {noSource ? (
                    <td colSpan={PROVIDER_TRUST.length} className={styles.abstainNote}>
                      No source had it. Beacon abstained instead of guessing.
                      {onFile[row.axis] !== undefined &&
                        ` ${onFile[row.axis].pending ? "Pending" : "On file"}: ${onFile[row.axis].text}.`}
                    </td>
                  ) : (
                    PROVIDER_TRUST.map((p) => (
                      <td
                        key={p}
                        data-label={providerLabel(p)}
                        data-empty={
                          row.cells[p].value === null &&
                          !row.rejections.some((r) => r.provider === p)
                            ? "true"
                            : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(row.axis, row.cells[p].value !== null ? p : undefined);
                        }}
                      >
                        <ProviderCell row={row} provider={p} />
                      </td>
                    ))
                  )}
                  <td className={styles.status}>
                    <RowStatus state={row.state} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
