/**
 * SQL for the trust metrics: `classify` from shared/trustMetrics.ts, evaluated
 * in the database so the server never ships finding rows. The two must agree
 * (functions.test.ts holds them to it).
 */
import type { FindingCell, RateCounts } from "../../shared/trustMetrics.js";
import { ANALYST, MARKET_SIGNAL } from "../../shared/vocab.js";
import type { Queryable } from "../db/client.js";

/**
 * One row per finding with its class as booleans (the findings of a hidden firm, $1, are left out); provider and axis folded like cellsFromFindings.
 * An analyst's own verified finding is an agreement (see classify). A synthetic market signal's
 * finding is news, not a reading of a source, so it is left out (see isMarketSignalFinding).
 */
const CLASSIFIED = `
  SELECT coalesce("provider", '') AS provider,
         btrim(coalesce("axis", '')) AS axis,
         abstain,
         (NOT abstain AND agreed) AS agree,
         (NOT abstain AND NOT agreed
            AND lower(coalesce("findingStatus", '')) = 'rejected') AS override
    FROM (
      SELECT *, (lower(coalesce("confidenceTier", '')) = 'abstain'
                 OR lower(coalesce("findingStatus", '')) = 'abstained') AS abstain,
                (coalesce("verifiedByHuman", false)
                 OR (lower(btrim(coalesce("provider", ''))) = '${ANALYST}'
                     AND lower(coalesce("findingStatus", '')) = 'verified')) AS agreed
        FROM research_finding
       WHERE lower(btrim(coalesce("provider", ''))) <> '${MARKET_SIGNAL}'
         AND ("firmId" IS NULL OR "firmId" <> ALL($1::text[]))
    ) f`;

const COUNTS = `
  count(*) FILTER (WHERE agree)::int AS agree,
  count(*) FILTER (WHERE override)::int AS override,
  count(*) FILTER (WHERE abstain)::int AS abstain,
  count(*)::int AS total`;

export async function findingTotals(q: Queryable, hidden: readonly string[]): Promise<RateCounts> {
  const [row] = await q.query<RateCounts>(`SELECT ${COUNTS} FROM (${CLASSIFIED}) c`, [hidden]);
  return row;
}

export function findingCells(q: Queryable, hidden: readonly string[]): Promise<FindingCell[]> {
  return q.query<FindingCell>(
    `SELECT provider, axis, ${COUNTS} FROM (${CLASSIFIED}) c GROUP BY provider, axis`,
    [hidden],
  );
}
