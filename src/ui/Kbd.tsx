import type { ReactNode } from "react";
import styles from "./Kbd.module.css";

/**
 * A keyboard hint, such as the V in "Verify V". A hint on a button gives way on a narrow window.
 * A key in a list of shortcuts (`listed`, as in the `?` overlay and the command palette) is the
 * content there, so it stays at any width.
 */
export function Kbd({ children, listed = false }: { children: ReactNode; listed?: boolean }) {
  return <kbd className={listed ? `${styles.kbd} ${styles.listed}` : styles.kbd}>{children}</kbd>;
}
