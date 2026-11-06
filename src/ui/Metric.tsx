import styles from "./Metric.module.css";
import { Panel } from "./Panel";
import { Sparkline } from "./Sparkline";

interface MetricProps {
  label: string;
  value: string | number;
  unit?: string;
  /** One line saying what the number means, so it never stands alone. */
  meaning: string;
  /** Omit when the data cannot support a trend. A null delta hides the delta only. */
  trend?: { points: number[]; delta: number | null } | null;
  highlighted?: boolean;
}

function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}`;
  }
  return delta < 0 ? `−${Math.abs(delta)}` : "0";
}

/** A headline number with its meaning, and an optional computed delta and trend line. */
export function Metric({ label, value, unit, meaning, trend, highlighted }: MetricProps) {
  const delta = trend?.delta ?? null;
  return (
    <Panel className={styles.metric} highlighted={highlighted}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        {value}
        {unit !== undefined && <small>{unit}</small>}
      </div>
      <div className={styles.meaning}>
        {delta !== null && (
          <b className={delta > 0 ? styles.up : delta < 0 ? styles.down : undefined}>
            {formatDelta(delta)}{" "}
          </b>
        )}
        {meaning}
      </div>
      {trend && trend.points.length >= 2 && (
        <div className={styles.spark}>
          <Sparkline points={trend.points} tone={highlighted ? "accent" : "green"} />
        </div>
      )}
    </Panel>
  );
}
