import type { ResolvedParams } from "../../shared/actionParams.js";
import type { ActionName } from "../../shared/schema.js";
import { acknowledgeDrift, keepPassed, reEngageFirm, setFirmOutcome } from "./drift.js";
import { enrichFirm, resolveConflict, runAgentEnrichment, verifyFinding } from "./findings.js";
import { advanceStage, qualifyFirm, rejectFirm } from "./firms.js";
import {
  amendRuleThreshold,
  approveRule,
  clusterRejections,
  dismissRule,
  unapproveRule,
} from "./rules.js";
import { runMandateSearch, runSearch } from "./search.js";
import type { ActionDef } from "./types.js";

/** Every action's definition, typed by its own validated params. A missing name fails to compile. */
export type ActionRegistry = { readonly [N in ActionName]: ActionDef<ResolvedParams<N>, unknown> };

export const ACTIONS: ActionRegistry = {
  qualifyFirm,
  rejectFirm,
  advanceStage,
  setFirmOutcome,
  reEngageFirm,
  keepPassed,
  acknowledgeDrift,
  runAgentEnrichment,
  verifyFinding,
  resolveConflict,
  enrichFirm,
  runMandateSearch,
  runSearch,
  clusterRejections,
  approveRule,
  dismissRule,
  unapproveRule,
  amendRuleThreshold,
};
