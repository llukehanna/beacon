import styles from "./Metric.module.css";
import { Panel } from "./Panel";
import { Sparkline } from "./Sparkline";
import { type MetricTrend, visibleTrend } from "./metricTrend";

interface MetricProps {
  label: string;
  value: string | number;
  unit?: string;
  /** One line saying what the number means, so it never stands alone. */
  meaning: string;
  /** Small mono note opposite the label, such as how many findings stand behind the number. */
  aside?: string;
  /**
   * Omit when the data cannot support a trend. A flat series shows neither line nor delta, and a
   * delta of 0 is never shown.
   */
  trend?: MetricTrend | null;
  /** Colour of the trend line; the delta's own colour always follows its sign. */
  tone?: "accent" | "green" | "muted";
  /** Hide the delta where its direction is not good or bad news (an abstention rate). */
  hideDelta?: boolean;
  highlighted?: boolean;
}

function formatDelta(delta: number): string {
  return delta > 0 ? `▲ ${delta} pts` : `▼ ${Math.abs(delta)} pts`;
}

/** A headline number with its meaning, and an optional computed delta and trend line. */
export function Metric({
  label,
  value,
  unit,
  meaning,
  aside,
  trend,
  tone,
  hideDelta,
  highlighted,
}: MetricProps) {
  const shown = visibleTrend(trend);
  const delta = hideDelta ? null : shown.delta;
  return (
    <Panel className={styles.metric} highlighted={highlighted}>
      <div className={styles.label}>
        <span>{label}</span>
        {aside !== undefined && <span className={styles.aside}>{aside}</span>}
      </div>
      <div className={styles.value}>
        {value}
        {unit !== undefined && <small>{unit}</small>}
      </div>
      <div className={styles.meaning}>
        {delta !== null && (
          <b className={delta > 0 ? styles.up : styles.down}>{formatDelta(delta)} </b>
        )}
        {meaning}
      </div>
      {shown.points !== null && (
        <div className={styles.spark}>
          <Sparkline points={shown.points} tone={tone ?? (highlighted ? "accent" : "green")} />
        </div>
      )}
    </Panel>
  );
}
