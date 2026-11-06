import React from "react";
import { PageHeader } from "@/ui";
import styles from "./DocLayout.module.css";

/** The frame About and Trust share: a header, then one scrolling column of titled sections. */
export function DocPage({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.page}>
      <PageHeader title={title} sub={sub} />
      <div className={styles.scroll}>
        <div className={styles.column}>{children}</div>
      </div>
    </div>
  );
}

/** A titled block of prose. `id` anchors the heading and names the region for assistive tech. */
export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** An outbound link to another site, opened in a new tab. */
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}
