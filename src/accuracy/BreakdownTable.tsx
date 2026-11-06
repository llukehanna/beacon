import React from "react";
import { SectionHead } from "@/home/SectionHead";
import { Panel } from "@/ui";
import { type Rates } from "../../shared/trustMetrics";
import styles from "./BreakdownTable.module.css";
import { rateCell, sampleNote } from "./accuracyModel";

export interface BreakdownRow {
  key: string;
  label: React.ReactNode;
  r: Rates;
}

function Cell({
  pct,
  sample,
  bar,
  tone,
}: {
  pct: number | null;
  sample: number;
  bar?: boolean;
  tone?: "override";
}) {
  const cell = rateCell(pct, sample);
  return (
    <td
      className={styles.rate}
      data-sparse={cell.sparse || undefined}
      data-tone={tone !== undefined && cell.pct !== null && cell.pct > 0 ? tone : undefined}
    >
      <span className={styles.cell}>
        {bar === true && cell.pct !== null && (
          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ width: `${cell.pct}%` }} />
          </span>
        )}
        {cell.text}
      </span>
    </td>
  );
}

/**
 * Agreement, override and abstention for each group of findings. Agreement and override share a
 * denominator (decided findings, abstains excluded) and abstention uses another (all findings), so
 * the header says which is which: the percentages are of different totals and must not be read as
 * one that sums to 100.
 */
export function BreakdownTable({
  title,
  groupLabel,
  rows,
}: {
  title: string;
  /** Heading of the first column. */
  groupLabel: string;
  rows: readonly BreakdownRow[];
}): React.ReactElement {
  return (
    <Panel className={styles.panel} aria-label={title}>
      <SectionHead title={title} count={rows.length} />
      {rows.length === 0 ? (
        <p className={styles.none}>No findings yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.groups}>
                <td />
                <th scope="colgroup" colSpan={2} className={styles.group}>
                  Of decided
                </th>
                <th scope="col" className={styles.group}>
                  Of all findings
                </th>
              </tr>
              <tr>
                <th scope="col" className={styles.first}>
                  {groupLabel}
                </th>
                <th scope="col">Agreement</th>
                <th scope="col">Override</th>
                <th scope="col">Abstention</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} title={sampleNote(row.r.decided, row.r.total)}>
                  <th scope="row" className={styles.label}>
                    {row.label}
                  </th>
                  <Cell pct={row.r.agreement} sample={row.r.decided} bar />
                  <Cell pct={row.r.override} sample={row.r.decided} tone="override" />
                  <Cell pct={row.r.abstention} sample={row.r.total} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.axis}>Bar length is the agreement rate; a full bar is 100%.</p>
    </Panel>
  );
}
