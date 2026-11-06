/** Pure helpers for what the shell reports about the data layer and the active mandate. */

export interface QueryTimes {
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export interface SyncSummary {
  /** When data last arrived from the server; null before the first response. */
  lastSyncedAt: number | null;
  /** True when the most recent response was a failure. */
  unreachable: boolean;
}

/** Reads the whole query cache as one status: the latest success, and whether a failure came after it. */
export function summarizeSync(queries: readonly QueryTimes[]): SyncSummary {
  let lastData = 0;
  let lastError = 0;
  for (const q of queries) {
    lastData = Math.max(lastData, q.dataUpdatedAt);
    lastError = Math.max(lastError, q.errorUpdatedAt);
  }
  return { lastSyncedAt: lastData > 0 ? lastData : null, unreachable: lastError > lastData };
}

/** "5s ago", "3m ago", "2h ago". */
export function syncedAgo(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * The sidebar's second line: the mandate the Desk is scoped to when one is selected, otherwise the
 * number of active mandates. Null while that number is still loading.
 */
export function mandateSubtitle(
  scopedMandate: string | null,
  activeCount: number | undefined,
): string | null {
  const scoped = scopedMandate?.trim() ?? "";
  if (scoped !== "") {
    return scoped;
  }
  if (activeCount === undefined) {
    return null;
  }
  if (activeCount === 0) {
    return "No active mandates";
  }
  return `${activeCount} active mandate${activeCount === 1 ? "" : "s"}`;
}
