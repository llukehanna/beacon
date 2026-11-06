import { formatScore, scoreFraction } from "@/desk/scoreFormat";
import { TIER_COLOR } from "@/desk/tokens";
import styles from "./FitCell.module.css";
import { TierTag } from "./chips";
import { type Row, isOut, rejectText } from "./pipelineModel";

/** The score and tier, or for a firm that is out, the score and why it is out. */
export function FitCell({ row }: { row: Row }) {
  const { mirror, score, rejectionRationale } = row;
  if (isOut(row)) {
    const reason = rejectText(mirror, rejectionRationale);
    return (
      <div className={styles.out} title={`${formatScore(score.total, score.tier)} · ${reason}`}>
        <span className={styles.score}>{formatScore(score.total, score.tier)}</span>
        <span className={styles.reason}>{reason}</span>
      </div>
    );
  }
  const tierColor = TIER_COLOR[score.tier] ?? TIER_COLOR.Rejected;
  return (
    <div className={styles.fit}>
      <span className={styles.score} style={{ color: tierColor }}>
        {formatScore(score.total)}
      </span>
      <TierTag tier={score.tier} />
      <span className={styles.bar} aria-hidden="true">
        <span style={{ width: `${scoreFraction(score.total) * 100}%`, background: tierColor }} />
      </span>
    </div>
  );
}
