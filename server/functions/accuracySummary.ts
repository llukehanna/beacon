import type { AccuracySummary } from "../../shared/summaries.js";
import {
  type FirmOutcomeGroup,
  accuracyTables,
  tallyOutcomeGroups,
} from "../../shared/trustMetrics.js";
import type { Queryable } from "../db/client.js";
import { findingCells } from "./findings.js";
import { outcomeGroups } from "./outcomes.js";

/** The /accuracy page's tables and outcome tally, aggregated in SQL. */
export async function accuracySummary(q: Queryable): Promise<AccuracySummary> {
  const [cells, groups] = await Promise.all([findingCells(q), outcomeGroups(q)]);
  return { ...accuracyTables(cells), outcomes: tallyOutcomeGroups(groups as FirmOutcomeGroup[]) };
}
