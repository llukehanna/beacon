import type { ActionStat } from "../../shared/operations.js";
import type { DaySpend, OperationsSummary } from "../../shared/summaries.js";
import { CLAUDE_DAILY_MAX } from "../clustering/choose.js";
import type { Queryable } from "../db/client.js";
import { getMeta } from "../db/meta.js";

const round = (n: number, places: number): number => Number(n.toFixed(places));

/**
 * The Operations tab: per-action latency and errors, and live Claude spend per UTC day, since the last
 * reset. Both are aggregated in SQL, so a table of thousands of runs costs the Worker one small result.
 * `percentile_disc` is the nearest-rank percentile (the first value whose rank reaches the fraction),
 * the definition `percentiles` in shared/operations.ts states; it exists on PGlite and on Neon.
 */
export async function operationsSummary(q: Queryable): Promise<OperationsSummary> {
  const [windowStart, actions, days] = await Promise.all([
    getMeta(q, "lastResetAt"),
    q.query<ActionStat>(
      `SELECT "actionName",
              count(*)::int AS count,
              (count(*) FILTER (WHERE "ok" IS NOT TRUE))::int AS errors,
              (percentile_disc(0.5) WITHIN GROUP (ORDER BY "durationMs"))::int AS "p50Ms",
              (percentile_disc(0.95) WITHIN GROUP (ORDER BY "durationMs"))::int AS "p95Ms"
       FROM action_run GROUP BY "actionName"
       ORDER BY count(*) DESC, "actionName" COLLATE "C"`,
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
    actions,
    spend: days.map((d) => ({ ...d, costUsd: round(d.costUsd, 6) })),
    dailyCallCap: CLAUDE_DAILY_MAX,
  };
}
