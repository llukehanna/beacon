import type { FirmOutcomeGroup } from "../../shared/trustMetrics.js";
import type { Queryable } from "../db/client.js";

/** Firms grouped by the columns the outcome tally reads. */
export async function outcomeGroups(q: Queryable): Promise<FirmOutcomeGroup[]> {
  return q.query<FirmOutcomeGroup>(
    `SELECT "lifecycleState", "disposition", "outcome", "outcomeSource", count(*)::int AS n
       FROM firm GROUP BY "lifecycleState", "disposition", "outcome", "outcomeSource"`,
  );
}
