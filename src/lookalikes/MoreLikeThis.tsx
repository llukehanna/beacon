import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { Firm } from "@/data/ontology";
import { Notice, Panel, Skeleton } from "@/ui";
import { moreLikeThis } from "../../shared/lookalikes";
import { LookalikeList } from "./LookalikeList";
import styles from "./MoreLikeThis.module.css";

/**
 * The firms most like this one, with the reasons. Computed in the browser over the firms the app
 * already loads for the Desk and the Pipeline (same query, so the list is shared, not refetched).
 */
export function MoreLikeThis({
  firmId,
  className,
}: {
  firmId: string;
  className?: string;
}): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const rows = React.useMemo(
    () => (data === undefined ? [] : moreLikeThis(firmId, data)),
    [data, firmId],
  );
  const headingId = React.useId();
  return (
    <Panel
      className={[styles.panel, className ?? ""].filter(Boolean).join(" ")}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className={styles.heading}>
        More like this
      </h2>
      {error !== undefined && error !== null ? (
        <Notice>Couldn’t load the firms to compare. Check your connection and try again.</Notice>
      ) : isLoading ? (
        <Skeleton lines={3} />
      ) : rows.length === 0 ? (
        <p className={styles.plain}>
          No other firm shares a sector, coverage model, HQ country, size or deal profile with this
          one, or this firm has too few fields on file to compare.
        </p>
      ) : (
        <>
          <p className={styles.plain}>
            Firms with the most in common on the record. Passed firms are listed too, flagged.
          </p>
          <LookalikeList rows={rows} label="Firms like this one" />
        </>
      )}
    </Panel>
  );
}
