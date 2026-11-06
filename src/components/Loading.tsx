import React from "react";
import { Panel, Skeleton } from "@/ui";
import styles from "./Loading.module.css";

/** The fallback while a page's code loads: the shape of a page header and its first panels. */
function Loading(): React.ReactElement {
  return (
    <div className={styles.page} role="status" aria-label="Loading">
      <div className={styles.title}>
        <Skeleton height={20} />
      </div>
      <div className={styles.sub}>
        <Skeleton height={12} />
      </div>
      <div className={styles.panels}>
        <Panel className={styles.panel}>
          <Skeleton lines={3} />
        </Panel>
        <Panel className={styles.panel}>
          <Skeleton lines={3} />
        </Panel>
      </div>
    </div>
  );
}

export default Loading;
