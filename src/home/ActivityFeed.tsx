import { Link } from "react-router-dom";
import { ACTIVITY_FEED_NOTE } from "@/about/facts";
import { EmptyState, Panel, Skeleton } from "@/ui";
import type { ActivityItem, ActivityKind } from "../../shared/activityFeed";
import styles from "./ActivityFeed.module.css";
import { SectionHead } from "./SectionHead";
import { relativeAge } from "./age";

const DOT: Record<ActivityKind, string> = {
  enriched: styles.green,
  conflict: styles.amber,
  abstained: styles.quiet,
  rule_proposed: styles.accent,
  drift: styles.amber,
};

/** Where an event opens: the firm on the desk, or the page that owns the thing. */
function hrefOf(item: ActivityItem): string {
  if (item.firmId !== null) {
    return `/desk?firmId=${encodeURIComponent(item.firmId)}`;
  }
  return item.kind === "rule_proposed" ? "/rules" : "/review";
}

/** What the agent has done lately, newest first, from the timestamps the data already holds. */
export function ActivityFeed({
  items,
  now,
}: {
  /** Undefined while the summary is in flight. */
  items: readonly ActivityItem[] | undefined;
  now: number;
}) {
  return (
    <Panel className={styles.feed} aria-label="Agent activity">
      <SectionHead title="Agent activity" />
      <p className={styles.note}>{ACTIVITY_FEED_NOTE}</p>
      {items === undefined && (
        <div className={styles.pad}>
          <Skeleton lines={6} />
        </div>
      )}
      {items?.length === 0 && (
        <div className={styles.pad}>
          <EmptyState
            title="No agent activity yet"
            body="Enrichment runs, conflicts and abstentions appear here as the agent works."
          />
        </div>
      )}
      {items?.map((item) => {
        const age = relativeAge(item.at, now);
        return (
          <Link
            key={`${item.kind}:${item.firmId ?? ""}:${item.at}:${item.title}`}
            to={hrefOf(item)}
            className={styles.event}
          >
            <span className={`${styles.dot} ${DOT[item.kind]}`} aria-hidden="true" />
            <span className={styles.body}>
              <b>{item.title}</b>
              <span className={styles.meta}>{item.detail}</span>
            </span>
            <span className={styles.age}>{age}</span>
          </Link>
        );
      })}
    </Panel>
  );
}
