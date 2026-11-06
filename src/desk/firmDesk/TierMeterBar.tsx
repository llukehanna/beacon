import React from "react";
import { MAX_POSSIBLE, TIER_THRESHOLDS } from "../scoreMirror";
import type { Model } from "../scoreMirror";
import styles from "./TierMeterBar.module.css";
import { type MeterTier, tierMeter } from "./tierMeter";

const SEGMENT_LABEL: Record<MeterTier, string> = {
  Rejected: "Rejected",
  C: "C",
  B: "B",
  A: "A",
};

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
}: {
  score: number;
  model: Model;
  prior?: number | null;
}): React.ReactElement {
  const meter = tierMeter(score, MAX_POSSIBLE, TIER_THRESHOLDS[model], prior);
  const label =
    `Score ${score} of ${MAX_POSSIBLE}, tier ${meter.tier}` +
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
          >
            {SEGMENT_LABEL[s.tier]}
          </span>
        ))}
      </div>
    </div>
  );
}
