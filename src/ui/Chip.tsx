import type { HTMLAttributes } from "react";
import styles from "./Chip.module.css";

/** A small neutral label: sector, city, source name. */
export function Chip({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={[styles.chip, className ?? ""].filter(Boolean).join(" ")} {...rest} />;
}
