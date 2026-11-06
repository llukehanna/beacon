import React from "react";
import { type MirrorResult } from "../scoreMirror";
import styles from "./SpineAxes.module.css";
import { type FirmView, humanAxisValue } from "./deskModel";

/** Rubric axes scored from the firm record alone: no source is queried for them. */
const FROM_RECORD = ["Coverage Model", "Geographic Footprint", "Headcount"];

/** What the three record-scored axes read and score, beside the grid of queried axes. */
export function SpineAxes({
  firm,
  mirror,
}: {
  firm: FirmView;
  mirror: MirrorResult;
}): React.ReactElement | null {
  const axes = mirror.axisScores.filter((a) => FROM_RECORD.includes(a.axis));
  if (axes.length === 0) {
    return null;
  }
  return (
    <section className={styles.spine} aria-label="Axes scored from the firm record">
      <span className={styles.lead}>Scored from the firm record</span>
      {axes.map((a) => (
        <span key={a.axis} className={styles.item}>
          <span className={styles.name}>{a.axis}</span>
          <span className={styles.value}>{a.known ? humanAxisValue(a.axis, firm) : "—"}</span>
          <span className={styles.score} title="Points on this axis, out of 2">
            {a.known ? `${a.score} / 2` : "unknown"}
          </span>
        </span>
      ))}
    </section>
  );
}
