import React from "react";
import { Link } from "react-router-dom";
import { StageChip, TierTag } from "@/pipeline/chips";
import type { ApprovedLookalike, LookalikeRow } from "../../shared/lookalikes";
import styles from "./LookalikeList.module.css";

/**
 * Lookalike firms, best first. Each links to the firm's Desk and shows its tier and stage, how
 * close it is and the fields that matched. A passed firm is listed with its Passed chip rather
 * than left out, so the analyst can see why a lookalike was turned down.
 */
export function LookalikeList({
  rows,
  label,
}: {
  rows: ReadonlyArray<LookalikeRow | ApprovedLookalike>;
  /** Accessible name of the list. */
  label: string;
}): React.ReactElement {
  return (
    <ul className={styles.list} aria-label={label}>
      {rows.map((row) => (
        <li key={row.firmId} className={styles.item}>
          <div className={styles.head}>
            <Link to={`/desk?firmId=${encodeURIComponent(row.firmId)}`} className={styles.name}>
              {row.name}
            </Link>
            <span className={styles.tier}>
              {row.tier !== "Rejected" && <span className="sr-only">Tier </span>}
              <TierTag tier={row.tier} spell />
            </span>
            <StageChip stage={row.stage} />
            <span className={styles.score}>
              {row.matched} of {row.compared} fields matched
            </span>
          </div>
          <ul className={styles.reasons} aria-label={`Why ${row.name} is alike`}>
            {row.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {"basedOn" in row && <p className={styles.basis}>Closest to {row.basedOn.name}</p>}
        </li>
      ))}
    </ul>
  );
}
