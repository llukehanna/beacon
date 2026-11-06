import styles from "./ConfidenceBars.module.css";
import { CONFIDENCE_BAR_TOTAL, type ConfidenceLevel, confidenceBarCount } from "./confidence";

const LABEL: Record<"high" | "low", string> = { high: "High confidence", low: "Low confidence" };

/** Three small bars: green for high confidence, amber for low, all dim when unknown. */
export function ConfidenceBars({ level }: { level: ConfidenceLevel }) {
  const lit = confidenceBarCount(level);
  return (
    <span
      className={`${styles.bars} ${level === "low" ? styles.low : ""}`}
      role="img"
      aria-label={level === null ? "Confidence unknown" : LABEL[level]}
    >
      {Array.from({ length: CONFIDENCE_BAR_TOTAL }, (_, i) => (
        <i key={i} className={i < lit ? styles.on : undefined} />
      ))}
    </span>
  );
}
