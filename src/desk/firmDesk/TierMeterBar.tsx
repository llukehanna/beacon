import React from "react";
import { useRubric } from "@/data/rubricContext";
import { maxPossible, resolveThesis } from "../../../shared/rubric/engine";
import styles from "./TierMeterBar.module.css";
import { belowCGloss, segmentLabel, tierMeter } from "./tierMeter";

const pct = (fraction: number): string => `${fraction * 100}%`;

/**
 * Where a score sits across the rubric's tiers: segments sized to the model's real thresholds, a
 * white pin at the score and, when the firm was scored before its last enrichment, a faint ghost
 * pin at that earlier score.
 */
export function TierMeterBar({
  score,
  model,
  prior,
  hard = false,
}: {
  score: number;
  /** The thesis the firm is scored under: its tier cuts size the segments. */
  model: string;
  prior?: number | null;
  /** True when the firm is hard-screened out, which is what makes the lowest segment "Rejected". */
  hard?: boolean;
}): React.ReactElement {
  const thesis = resolveThesis(useRubric().definition, model);
  const MAX_POSSIBLE = maxPossible(thesis);
  const meter = tierMeter(score, MAX_POSSIBLE, thesis.tiers, prior);
  const label =
    `Score ${score} of ${MAX_POSSIBLE}, ${meter.tier === "Rejected" ? segmentLabel(meter.tier, hard) : `tier ${meter.tier}`}` +
    (meter.ghost === null ? "" : `. Before the last enrichment: ${prior}`);
  return (
    <div className={styles.meter} role="img" aria-label={label}>
      <div className={styles.track}>
        {meter.segments.map((s, i) => (
          <span
            key={s.tier}
            className={`${styles.segment} ${s.tier === meter.tier ? styles.current : ""}`}
            style={{
              left: pct(s.from),
              width: `calc(${pct(s.to - s.from)} - ${i === meter.segments.length - 1 ? 0 : 3}px)`,
            }}
          />
        ))}
        {meter.ghost !== null && (
          <i className={styles.ghost} style={{ left: `calc(${pct(meter.ghost)} - 1px)` }} />
        )}
        <i className={styles.pin} style={{ left: `calc(${pct(meter.pin)} - 1px)` }} />
      </div>
      <div className={styles.scale} aria-hidden="true">
        {meter.segments.map((s) => (
          <span
            key={s.tier}
            className={s.tier === meter.tier ? styles.scaleCurrent : undefined}
            style={{ left: pct(s.from) }}
            title={belowCGloss(s.tier, hard, thesis.tiers.C, MAX_POSSIBLE) ?? undefined}
          >
            {segmentLabel(s.tier, hard)}
          </span>
        ))}
      </div>
    </div>
  );
}
