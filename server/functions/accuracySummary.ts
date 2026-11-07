import type { AccuracySummary } from "../../shared/summaries.js";
import { accuracyTables, tallyOutcomeGroups } from "../../shared/trustMetrics.js";
import type { Access } from "../access.js";
import type { Queryable } from "../db/client.js";
import { findingCells } from "./findings.js";
import { outcomeGroups } from "./outcomes.js";

/** The /accuracy page's tables and outcome tally, aggregated in SQL; a hidden firm counts for nothing. */
export async function accuracySummary(q: Queryable, access: Access): Promise<AccuracySummary> {
  const hidden = access.hiddenFirmIds;
  const [cells, groups] = await Promise.all([findingCells(q, hidden), outcomeGroups(q, hidden)]);
  return { ...accuracyTables(cells), outcomes: tallyOutcomeGroups(groups) };
}
