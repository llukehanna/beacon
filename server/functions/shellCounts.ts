/**
 * The three counts the app shell shows on every route (sidebar badges, status bar), without the
 * rest of Home's work: no finding scans, trends, activity or inbox ranking. Each figure applies
 * the same definition homeSummary does, so a badge never disagrees with the page it links to.
 */
import { bucketOf, isOpenBucket } from "../../shared/pipelineBuckets.js";
import { mirrorScore } from "../../shared/scoreMirror.js";
import type { ShellCounts } from "../../shared/summaries.js";
import type { Access } from "../access.js";
import type { Queryable } from "../db/client.js";
import { notIn } from "../db/repo.js";
import { ACTIVE_MANDATE_WHERE, OPEN_DRIFT_WHERE } from "./homeSummary.js";

interface FirmGroup {
  lifecycleState: string | null;
  currentStage: string | null;
  disposition: string | null;
  firmType: string | null;
  coverageModel: string | null;
  servicesFit: string | null;
  balanceSheetPrincipal: string | null;
  advisoryConflict: boolean | null;
  n: number;
}

/**
 * Open firms by the funnel's own bucket rule. A firm's bucket depends on its lifecycle columns
 * and on the hard-reject verdict (which reads a handful of score inputs), so the firms are
 * grouped by exactly those columns in SQL and the shared rule runs once per distinct group,
 * weighted by its size, instead of once per firm.
 */
async function openFirmCount(q: Queryable, hidden: readonly string[]): Promise<number> {
  const groups = await q.query<FirmGroup>(
    `SELECT "lifecycleState", "currentStage", "disposition", "firmType", "coverageModel",
            "servicesFit", "balanceSheetPrincipal", "advisoryConflict", count(*)::int AS n
       FROM firm
      WHERE ${notIn('"firmId"', 1)}
      GROUP BY "lifecycleState", "currentStage", "disposition", "firmType", "coverageModel",
               "servicesFit", "balanceSheetPrincipal", "advisoryConflict"`,
    [hidden],
  );
  return groups.reduce(
    (sum, g) => (isOpenBucket(bucketOf(g, mirrorScore(g))) ? sum + g.n : sum),
    0,
  );
}

async function countWhere(
  q: Queryable,
  table: string,
  where: string,
  params: unknown[] = [],
): Promise<number> {
  const [row] = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
    params,
  );
  return row?.n ?? 0;
}

export async function shellCounts(q: Queryable, access: Access): Promise<ShellCounts> {
  const [open, review, activeMandates] = await Promise.all([
    openFirmCount(q, access.hiddenFirmIds),
    countWhere(q, "drift_event", `${OPEN_DRIFT_WHERE} AND ${notIn('"firmId"', 1)}`, [
      access.hiddenFirmIds,
    ]),
    countWhere(q, "mandate", ACTIVE_MANDATE_WHERE),
  ]);
  return { open, review, activeMandates };
}
