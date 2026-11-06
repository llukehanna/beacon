/**
 * The agent's findings for one firm, planned from the firm and that firm's own stored extraction
 * rows. Pure: no DB, no network, so the seed can preview the plans before it writes anything.
 */
import type { ObjectOf } from "../../shared/schema.js";
import { firmModel } from "../../shared/scoring.js";
import { type AxisDef, ENRICH_AXES, type Provider } from "../../shared/vocab.js";
import { type FindingPlan, reconcileAxis } from "../enrichment/reconcile.js";
import {
  EXTRACTION_PROMPT_VERSION,
  type ExtractionOutput,
  RULE_BASED_MODEL,
  ruleBasedExtraction,
} from "./contract.js";
import { type SourceDocument, documentsHash, firmDocuments } from "./documents.js";
import { type GroundingResult, groundExtraction } from "./grounding.js";

/**
 * The stored extraction for these documents, or the rule-based one. Rows made against other
 * document text or another prompt version are ignored. If rows from several models match, the
 * model that sorts first is used, so the result never depends on row order.
 */
export function extractionFromRows(
  docs: readonly SourceDocument[],
  rows: readonly ObjectOf<"Extraction">[],
): { output: ExtractionOutput; model: string } {
  const hash = documentsHash(docs);
  const current = rows.filter(
    (r) => r.documentsHash === hash && r.promptVersion === EXTRACTION_PROMPT_VERSION,
  );
  if (current.length === 0) {
    return { output: ruleBasedExtraction(docs), model: RULE_BASED_MODEL };
  }
  const model = current.map((r) => r.model ?? "").sort()[0];
  return {
    model,
    output: {
      items: current
        .filter((r) => (r.model ?? "") === model)
        .map((r) => ({
          provider: (r.provider ?? "") as Provider,
          axis: r.axis ?? "",
          value: r.value ?? null,
          quote: r.quote ?? null,
        })),
    },
  };
}

/**
 * What the agent reads for a firm: its four documents, the extraction in force (stored rows when
 * current, otherwise rule-based), and that extraction after grounding. The one place this is
 * decided, so the agent's plans and the per-provider view of them cannot drift apart.
 */
export function groundFirm(
  firm: ObjectOf<"Firm">,
  rows: readonly ObjectOf<"Extraction">[],
): {
  docs: SourceDocument[];
  extraction: { output: ExtractionOutput; model: string };
  grounded: GroundingResult;
} {
  const docs = firmDocuments(firm);
  const extraction = extractionFromRows(docs, rows);
  const grounded = groundExtraction(firm, docs, extraction.output, extraction.model);
  return { docs, extraction, grounded };
}

/**
 * One entry per axis the firm's model enriches (and `include` accepts), each with the findings
 * the agent would record for it: read, grounded, then reconciled.
 */
export function planFirmAxes(
  firm: ObjectOf<"Firm">,
  rows: readonly ObjectOf<"Extraction">[],
  newConflictId: () => string,
  include: (axis: AxisDef) => boolean = () => true,
): { axis: AxisDef; plans: FindingPlan[] }[] {
  const model = firmModel(firm);
  const { grounded } = groundFirm(firm, rows);
  return ENRICH_AXES.filter((axis) => axis.models.includes(model) && include(axis)).map((axis) => ({
    axis,
    plans: reconcileAxis(
      axis,
      grounded.observations.filter((o) => o.axis === axis.axis),
      newConflictId,
      { groundingRejected: grounded.rejected.some((r) => r.axis === axis.axis) },
    ),
  }));
}
