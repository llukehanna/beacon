import type { FirmOutcomeGroup } from "../../shared/trustMetrics.js";
import type { Queryable } from "../db/client.js";

/** Firms grouped by the columns the outcome tally reads, leaving out the hidden ones. */
export async function outcomeGroups(
  q: Queryable,
  hidden: readonly string[],
): Promise<FirmOutcomeGroup[]> {
  return q.query<FirmOutcomeGroup>(
    `SELECT "lifecycleState", "disposition", "outcome", "outcomeSource", count(*)::int AS n
       FROM firm WHERE "firmId" <> ALL($1::text[])
      GROUP BY "lifecycleState", "disposition", "outcome", "outcomeSource"`,
    [hidden],
  );
}
