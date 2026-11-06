import type { ReactNode } from "react";
import styles from "./Kbd.module.css";

/** A keyboard hint, such as the V in "Verify V". */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
