import React from "react";
import { type RejectionNote } from "@/desk/ruleEvidence";
import styles from "./RuleEvidence.module.css";
import { formatNoteDate } from "./rulesModel";

/**
 * The rejections a rule was drafted from: the analysts' own notes, newest first. The first few show
 * at once and the rest sit behind a toggle, so a rule backed by many rejections stays compact.
 */
export function RuleEvidence({
  basisCount,
  notes,
  supportingCount,
  limit = 2,
}: {
  /** How many rejections the rule is based on. */
  basisCount: number;
  notes: readonly RejectionNote[];
  /** How many decisions the rule lists; some have no written note. */
  supportingCount: number;
  /** Notes shown before the toggle. */
  limit?: number;
}) {
  const [all, setAll] = React.useState(false);
  if (basisCount <= 0) {
    return null;
  }
  const shown = all ? notes : notes.slice(0, limit);
  const silent = supportingCount - notes.length;
  return (
    <div className={styles.evidence}>
      <h3 className={styles.title}>
        Based on {basisCount} rejection{basisCount === 1 ? "" : "s"}
      </h3>
      {notes.length === 0 ? (
        <p className={styles.none}>No written notes are on file for these rejections.</p>
      ) : (
        <ul aria-label="Analyst rejection notes" className={styles.list}>
          {shown.map((n) => (
            <li key={n.decisionId} className={styles.note}>
              <span className={styles.quote}>&ldquo;{n.note}&rdquo;</span>
              <span className={styles.by}>
                {n.firmName}
                {n.decidedAtMs !== null && (
                  <>
                    {" · "}
                    <time dateTime={new Date(n.decidedAtMs).toISOString()}>
                      {formatNoteDate(n.decidedAtMs)}
                    </time>
                  </>
                )}
              </span>
            </li>
          ))}
          {silent > 0 && (all || notes.length <= limit) && (
            <li className={styles.by}>+{silent} more without a written note</li>
          )}
        </ul>
      )}
      {notes.length > limit && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `Show all ${notes.length} notes`}
        </button>
      )}
    </div>
  );
}
