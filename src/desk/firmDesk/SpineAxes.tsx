import React from "react";
import { useRubric } from "@/data/rubricContext";
import { axisLabel } from "../../../shared/axisLabels";
import { criterionMax, resolveThesis } from "../../../shared/rubric/engine";
import type { ScoreResult } from "../../../shared/rubric/types";
import styles from "./SpineAxes.module.css";
import { type FirmView, humanAxisValue } from "./deskModel";

/**
 * What the axes scored from the firm record alone (fact traits: no source is queried for them)
 * read and score, beside the grid of queried axes.
 */
export function SpineAxes({
  firm,
  mirror,
}: {
  firm: FirmView;
  mirror: ScoreResult;
}): React.ReactElement | null {
  const rubric = useRubric();
  const criteria = resolveThesis(rubric.definition, mirror.model).criteria;
  const fromRecord = criteria.filter(
    (c) => rubric.traits.find((t) => t.traitKey === c.traitKey)?.role === "fact",
  );
  const axes = mirror.axisScores.flatMap((a) => {
    const c = fromRecord.find((x) => x.label === a.axis);
    return c === undefined ? [] : [{ ...a, traitKey: c.traitKey, max: criterionMax(c) * c.weight }];
  });
  if (axes.length === 0) {
    return null;
  }
  return (
    <section className={styles.spine} aria-label="Axes scored from the firm record">
      <span className={styles.lead}>Scored from the firm record</span>
      {axes.map((a) => (
        <span key={a.axis} className={styles.item}>
          <span className={styles.name}>{axisLabel(rubric, a.axis)}</span>
          <span className={styles.value}>
            {a.known ? humanAxisValue(rubric, a.traitKey, firm) : "—"}
          </span>
          <span className={styles.score} title={`Points on this axis, out of ${a.max}`}>
            {a.known ? `${a.score} / ${a.max}` : "unknown"}
          </span>
        </span>
      ))}
    </section>
  );
}
