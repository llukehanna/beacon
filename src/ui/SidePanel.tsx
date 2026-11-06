import type { ReactNode } from "react";
import { Drawer } from "@blueprintjs/core";
import styles from "./SidePanel.module.css";

/**
 * A detail panel that sits to the right of a list. Wide screens get a column (nothing at all while
 * `open` is false); narrow ones get the same content in a right-hand drawer.
 */
export function SidePanel({
  open,
  asDrawer,
  label,
  title,
  onClose,
  children,
}: {
  open: boolean;
  /** Render as a drawer (under 1280 px) rather than a column. */
  asDrawer: boolean;
  /** Accessible name of the column. */
  label: string;
  /** Drawer title. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  if (asDrawer) {
    return (
      <Drawer
        isOpen={open}
        onClose={onClose}
        position="right"
        size="min(420px, 100vw)"
        title={title}
        className={`${styles.drawer} bp6-dark`}
      >
        <div className={styles.body}>{children}</div>
      </Drawer>
    );
  }
  if (!open) {
    return null;
  }
  return (
    <aside className={styles.column} aria-label={label}>
      {children}
    </aside>
  );
}
