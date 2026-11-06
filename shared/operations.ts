/**
 * Operations metrics, pure: how an action's latency reads (p50, p95), how runs group per action,
 * and how the measurement window is worded. The server feeds it rows; nothing here touches a database.
 */

export interface RunSample {
  actionName: string;
  durationMs: number;
  ok: boolean;
}

export interface ActionStat {
  actionName: string;
  count: number;
  /** Runs that threw (bad input, a missing object, the demo being full, an unexpected error). */
  errors: number;
  p50Ms: number;
  p95Ms: number;
}

/** Below this many runs the nearest-rank p95 is the slowest run itself (ceil(0.95 * n) = n for n up to 19). */
export const P95_MIN_RUNS = 20;

/** The 50th and 95th percentile by nearest rank (a value that was actually measured); null when there is nothing to measure. */
export function percentiles(durations: readonly number[]): { p50: number; p95: number } | null {
  if (durations.length === 0) {
    return null;
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
  return { p50: at(50), p95: at(95) };
}

/** One row per action that ran, busiest first (ties by name). */
export function summarizeRuns(runs: readonly RunSample[]): ActionStat[] {
  const byAction = new Map<string, RunSample[]>();
  for (const r of runs) {
    byAction.set(r.actionName, [...(byAction.get(r.actionName) ?? []), r]);
  }
  return [...byAction.entries()]
    .map(([actionName, rs]) => {
      const p = percentiles(rs.map((r) => r.durationMs))!;
      return {
        actionName,
        count: rs.length,
        errors: rs.filter((r) => !r.ok).length,
        p50Ms: p.p50,
        p95Ms: p.p95,
      };
    })
    .sort((a, b) => b.count - a.count || a.actionName.localeCompare(b.actionName));
}

/** "2026-11-06 04:00 UTC" from an ISO time; null when it does not parse. */
function utcMinute(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The sentence that says what the numbers cover: they start at the last reset, which clears them. */
export function windowLabel(lastResetAt: string | null): string {
  const at = lastResetAt === null ? null : utcMinute(lastResetAt);
  return at === null
    ? "since this database was set up (no reset recorded)"
    : `since the last reset at ${at}`;
}

/** US dollars for a model spend: cents-level precision, because one clustering call costs a few cents. */
export function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}
