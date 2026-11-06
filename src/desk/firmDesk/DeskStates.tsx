import React from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, Skeleton } from "@/ui";
import styles from "./DeskStates.module.css";

/** Nothing selected yet. */
export function PickAFirm(): React.ReactElement {
  return (
    <div className={styles.center}>
      <EmptyState
        title="Pick a firm"
        body="Choose a firm from the queue. Firms are ordered by how much a decision would change their score. Firms screened out by approved rules are hidden unless you turn on Show all firms."
      />
    </div>
  );
}

/** No firm exists yet: the queue fills when a mandate's search finds some. */
export function EmptyQueue(): React.ReactElement {
  return (
    <div className={styles.center}>
      <EmptyState
        title="The queue is empty"
        body="No firms have been found yet. Run a search from a mandate and the firms it finds will line up here, ordered by how much a decision would change their score."
        action={
          <Link to="/mandate" className={styles.link}>
            Open Mandates
          </Link>
        }
      />
    </div>
  );
}

/** The firm list could not be loaded; says why, in words. */
export function LoadFailed({ message }: { message: string }): React.ReactElement {
  return (
    <div className={styles.center}>
      <div role="alert">
        <EmptyState
          title="Couldn't load the Desk"
          body={`${message.replace(/[.\s]+$/, "")}. Reload the page to try again.`}
        />
      </div>
    </div>
  );
}

/** Placeholder while a deep-linked firm is still loading; shaped like the header, run strip and grid. */
export function FirmSkeleton(): React.ReactElement {
  return (
    <div role="status" aria-label="Loading firm" className={styles.skeletonLayout}>
      <div className={styles.skeleton}>
        <div className={styles.skeletonHero}>
          <Skeleton height={52} />
          <div className={styles.skeletonName}>
            <Skeleton height={26} />
            <Skeleton height={14} />
          </div>
          <div className={styles.skeletonScore}>
            <Skeleton height={96} />
          </div>
        </div>
        <Skeleton height={54} />
        <div className={styles.skeletonRows}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={38} />
          ))}
        </div>
        <div className={styles.skeletonBar}>
          <Skeleton height={96} />
        </div>
      </div>
      <aside className={styles.skeletonAside} aria-hidden="true">
        <div className={styles.skeletonTabs} />
        <div className={styles.skeletonEvidence}>
          <Skeleton height={14} />
          <Skeleton height={34} />
          <Skeleton height={140} />
          <Skeleton height={60} />
        </div>
      </aside>
    </div>
  );
}

/** A deep-linked firm that exists but is outside the pinned search's membership. */
export function FirmNotInSearch({ onClear }: { onClear: () => void }): React.ReactElement {
  return (
    <div className={styles.center}>
      <EmptyState
        title="This firm isn't in the current search"
        body="The queue is limited to the firms this search found. Clear the search filter to see every firm."
        action={<Button onClick={onClear}>Clear search filter</Button>}
      />
    </div>
  );
}

/** A deep-linked firm id that is not in the database. */
export function FirmNotFound({ firmId }: { firmId: string }): React.ReactElement {
  return (
    <div className={styles.center}>
      <EmptyState
        title="Firm not found"
        body={`No firm with id ${firmId} is in the database. Choose one from the queue.`}
      />
    </div>
  );
}

/** A pinned search with no members (or whose membership has not arrived). */
export function SearchEmpty({ loading }: { loading: boolean }): React.ReactElement {
  return (
    <div className={styles.center}>
      <EmptyState
        title={loading ? "Loading search membership…" : "This search returned no firms yet"}
        body={
          loading
            ? "The queue fills as soon as the search's firms arrive."
            : "If it just launched, give the backend a moment to attach dedupes and create discoveries. The queue populates as membership lands."
        }
      />
    </div>
  );
}
