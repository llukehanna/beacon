import type { ReactNode } from "react";
import { Panel } from "@/ui";
import styles from "./ErrorPanel.module.css";

/** A centred panel for a page or app that cannot show its content: what happened, and what to do. */
export function ErrorPanel({
  title,
  children,
  actions,
  role,
}: {
  title: string;
  /** The explanation under the title. */
  children: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className={styles.wrap}>
      <Panel className={styles.panel}>
        {/* The alert is the message; the buttons under it are not announced with it. */}
        <div role={role}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.message}>{children}</p>
        </div>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </Panel>
    </div>
  );
}
