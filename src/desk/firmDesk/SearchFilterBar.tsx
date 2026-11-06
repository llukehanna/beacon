import React from "react";
import { Button } from "@/ui";
import styles from "./SearchFilterBar.module.css";

// Top strip on the enrichment desk when the queue is pinned to a Search.
// Reads intent statement, search name / #N, and total member count. The
// "clear" button drops ?search from the URL, restoring the master queue.
export function SearchFilterBar({
  intentText,
  searchName,
  searchIndex,
  memberCount,
  loading,
  onClear,
}: {
  intentText: string;
  searchName?: string | null;
  // 1-based rank of this search under the mandate (freshest = 1). Used
  // when the search has no human-readable name — reads as "Search #2".
  searchIndex?: number;
  memberCount: number;
  loading: boolean;
  onClear: () => void;
}): React.ReactElement {
  const label = (searchName ?? "").trim() || (searchIndex ? `Search #${searchIndex}` : "Search");
  return (
    <div role="status" aria-live="polite" className={styles.bar}>
      <span className={styles.kicker}>Filtered</span>
      <span className={styles.text} title={intentText}>
        <strong>Mandate:</strong> {intentText || "—"}
        <span className={styles.sep}>·</span>
        {label}
        <span className={styles.sep}>·</span>
        {loading ? "loading firms…" : `${memberCount} firm${memberCount === 1 ? "" : "s"}`}
      </span>
      <Button variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
