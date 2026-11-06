import { summarizeRuns } from "../../shared/operations.js";
import type { DaySpend, OperationsSummary } from "../../shared/summaries.js";
import { CLAUDE_DAILY_MAX } from "../clustering/choose.js";
import type { Queryable } from "../db/client.js";
import { getMeta } from "../db/meta.js";

const round = (n: number, places: number): number => Number(n.toFixed(places));

/** The Operations tab: per-action latency and errors, and live Claude spend per UTC day, since the last reset. */
export async function operationsSummary(q: Queryable): Promise<OperationsSummary> {
  const [windowStart, runs, days] = await Promise.all([
    getMeta(q, "lastResetAt"),
    q.query<{ actionName: string; durationMs: number; ok: boolean }>(
      `SELECT "actionName", "durationMs", "ok" FROM action_run`,
    ),
    q.query<DaySpend>(
      `SELECT to_char("calledAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*)::int AS calls,
              coalesce(sum("inputTokens"), 0)::int AS "inputTokens",
              coalesce(sum("outputTokens"), 0)::int AS "outputTokens",
              coalesce(sum("costUsd"), 0)::float8 AS "costUsd"
       FROM model_call GROUP BY 1 ORDER BY 1 DESC`,
    ),
  ]);
  return {
    windowStart,
    actions: summarizeRuns(runs),
    spend: days.map((d) => ({ ...d, costUsd: round(d.costUsd, 6) })),
    dailyCallCap: CLAUDE_DAILY_MAX,
  };
}
