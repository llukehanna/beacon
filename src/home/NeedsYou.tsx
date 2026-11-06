import { Link } from "react-router-dom";
import { EmptyState, Panel, Skeleton } from "@/ui";
import type { NeedsYouDestination, NeedsYouItem } from "../../shared/summaries";
import styles from "./NeedsYou.module.css";
import { SectionHead } from "./SectionHead";
import { relativeAge } from "./age";
import { needsRow } from "./needsRows";

/** Rows shown before "+N more". */
export const NEEDS_YOU_ROWS = 5;

const DESTINATION_PATH: Record<NeedsYouDestination, string> = {
  review: "/review",
  desk: "/desk",
  rules: "/rules",
};

/** "+N more" opens whichever page owns the most of the hidden rows. */
function overflowPath(
  shown: readonly NeedsYouItem[],
  counts: Record<NeedsYouDestination, number>,
): string {
  const hidden = (d: NeedsYouDestination) =>
    counts[d] - shown.filter((i) => i.destination === d).length;
  const destinations = Object.keys(DESTINATION_PATH) as NeedsYouDestination[];
  return DESTINATION_PATH[destinations.reduce((best, d) => (hidden(d) > hidden(best) ? d : best))];
}

/** The most urgent work waiting on the analyst, each row opening where it is done. */
export function NeedsYou({
  items,
  total,
  counts,
  now,
}: {
  /** Undefined while the summary is in flight. */
  items: readonly NeedsYouItem[] | undefined;
  total: number;
  counts: Record<NeedsYouDestination, number> | undefined;
  now: number;
}) {
  const shown = (items ?? []).slice(0, NEEDS_YOU_ROWS);
  return (
    <Panel className={styles.needs} aria-label="Needs you">
      <SectionHead
        title="Needs you"
        count={items === undefined ? undefined : total}
        to="/review"
        linkLabel="Open review"
      />
      {items === undefined && (
        <div className={styles.pad}>
          <Skeleton lines={4} />
        </div>
      )}
      {items !== undefined && total === 0 && (
        <div className={styles.pad}>
          <EmptyState
            title="Nothing needs you"
            body="No firm has moved tier, no passed firm has been bought, and every axis has a source."
          />
        </div>
      )}
      {shown.map((item) => {
        const row = needsRow(item);
        const age = relativeAge(row.at, now);
        return (
          <Link key={row.key} to={row.to} className={styles.row}>
            <span className={`${styles.mark} ${styles[row.tone]}`} aria-hidden="true">
              {row.mark}
            </span>
            <span className={styles.text}>
              <b>{row.name}</b>
              <span className={styles.reason}>{row.reason}</span>
            </span>
            <span className={styles.figure}>
              {row.figure?.from !== undefined && row.figure.to !== undefined && (
                <>
                  {row.figure.from}{" "}
                  <i className={row.tone === "up" ? styles.gain : styles.loss}>→ {row.figure.to}</i>
                </>
              )}
              {row.figure?.text}
            </span>
            <span className={styles.age}>{age}</span>
          </Link>
        );
      })}
      {counts !== undefined && total > shown.length && (
        <Link to={overflowPath(shown, counts)} className={styles.more}>
          +{total - shown.length} more <span aria-hidden="true">→</span>
        </Link>
      )}
    </Panel>
  );
}
