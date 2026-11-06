import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

/**
 * The top of a page: one h1, a quiet line under it and, at the right, the page's main action.
 * `back` sits above the title for pages that hang off another one.
 */
export function PageHeader({
  title,
  sub,
  back,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div className={styles.titles}>
        {back !== undefined && <div className={styles.back}>{back}</div>}
        <h1 className={styles.title}>{title}</h1>
        {sub !== undefined && <p className={styles.sub}>{sub}</p>}
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
