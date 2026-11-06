import React from "react";
import styles from "./EvidenceColumn.module.css";

/**
 * The 340 px column on the right of the Desk. It holds the evidence behind the selected axis;
 * until a screen puts something in it, it says what will appear.
 */
export function EvidenceColumn({ children }: { children?: React.ReactNode }): React.ReactElement {
  return (
    <aside className={styles.evidence} aria-label="Evidence">
      <div className={styles.head}>Evidence</div>
      {children ?? <p className={styles.note}>The source behind each value appears here.</p>}
    </aside>
  );
}
