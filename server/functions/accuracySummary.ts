import type { AccuracySummary } from "../../shared/summaries.js";
import {
  type FirmOutcomeGroup,
  accuracyTables,
  tallyOutcomeGroups,
} from "../../shared/trustMetrics.js";
import { type Access, NO_WALL } from "../access.js";
import type { Queryable } from "../db/client.js";
import { findingCells } from "./findings.js";
import { outcomeGroups } from "./outcomes.js";

/** The /accuracy page's tables and outcome tally, aggregated in SQL; a hidden firm counts for nothing. */
export async function accuracySummary(
  q: Queryable,
  access: Access = NO_WALL,
): Promise<AccuracySummary> {
  const hidden = access.hiddenFirmIds;
  const [cells, groups] = await Promise.all([findingCells(q, hidden), outcomeGroups(q, hidden)]);
  return { ...accuracyTables(cells), outcomes: tallyOutcomeGroups(groups as FirmOutcomeGroup[]) };
}
