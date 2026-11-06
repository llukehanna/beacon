import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import styles from "./SectionHead.module.css";

/** A panel's header row: title, an optional mono count, and a link to where the work happens. */
export function SectionHead({
  title,
  count,
  to,
  linkLabel,
}: {
  title: ReactNode;
  count?: ReactNode;
  to?: string;
  linkLabel?: string;
}) {
  return (
    <div className={styles.head}>
      <h2 className={styles.title}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </h2>
      {to !== undefined && (
        <Link className={styles.link} to={to}>
          {linkLabel} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}
