import type { HTMLAttributes } from "react";
import styles from "./Notice.module.css";

/** A short message in a tinted bar: a failed action (error) or a fact the page cannot show (muted). */
export function Notice({
  tone = "error",
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: "error" | "muted" | "accent" }) {
  return (
    <div
      className={[styles.notice, styles[tone], className ?? ""].filter(Boolean).join(" ")}
      role={tone === "error" ? "alert" : undefined}
      {...rest}
    />
  );
}
