import type { CSSProperties } from "react";
import { TIER_COLOR, TIER_LABEL } from "@/desk/tokens";
import type { Lifecycle } from "../../shared/pipelineBuckets";
import styles from "./chips.module.css";

/** A firm's funnel stage: a dot and the stage name, tinted by how far along the firm is. */
export function StageChip({ stage }: { stage: Lifecycle }) {
  return (
    <span className={styles.stage} data-stage={stage}>
      {stage}
    </span>
  );
}

/**
 * The tier letter, coloured by tier: green A, amber B, red C, grey for below C. A table cell has
 * room only for "R"; where there is room (`spell`), it reads "Rejected".
 */
export function TierTag({ tier, spell = false }: { tier: string; spell?: boolean }) {
  const color = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  return (
    <span
      className={styles.tier}
      style={{ "--tier": color } as CSSProperties}
      title={TIER_LABEL[tier] ?? tier}
    >
      {tier === "Rejected" ? (spell ? "Rejected" : "R") : tier}
    </span>
  );
}
