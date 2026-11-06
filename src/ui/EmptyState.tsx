import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

/** What to show when a list has nothing in it: say why, and offer the next step. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className={`${styles.empty} hatch`}>
      <div className={styles.title}>{title}</div>
      <p className={styles.body}>{body}</p>
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  );
}
