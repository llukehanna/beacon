/**
 * The agent's findings for one firm, planned from the firm and that firm's own stored extraction
 * rows. Pure: no DB, no network, so the seed can preview the plans before it writes anything.
 */
import { evidenceTraits, researchedFor } from "../../shared/rubric/catalog.js";
import { thesisOf } from "../../shared/rubric/firm.js";
import type { TraitDef } from "../../shared/rubric/types.js";
import type { ObjectOf } from "../../shared/schema.js";
import type { Provider } from "../../shared/vocab.js";
import { ADVISORY_ACQUISITIONS as WS } from "../../shared/workspaces/advisoryAcquisitions.js";
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
 * What the agent reads for a firm (see `groundFirm`) and, for each axis the firm's model enriches
 * (and `include` accepts), the findings it would record: read, grounded, then reconciled. The one
 * place the agent's plans are made, so anything that measures them sees what the agent does.
 */
export function planFirm(
  firm: ObjectOf<"Firm">,
  rows: readonly ObjectOf<"Extraction">[],
  newConflictId: () => string,
  include: (axis: TraitDef) => boolean = () => true,
): ReturnType<typeof groundFirm> & { axes: { axis: TraitDef; plans: FindingPlan[] }[] } {
  const thesis = thesisOf(firm);
  const read = groundFirm(firm, rows);
  const { grounded } = read;
  const axes = evidenceTraits(WS.traits)
    .filter((axis) => researchedFor(WS.rubric, axis, thesis) && include(axis))
    .map((axis) => ({
      axis,
      plans: reconcileAxis(
        axis,
        grounded.observations.filter((o) => o.axis === axis.traitKey),
        newConflictId,
        { groundingRejected: grounded.rejected.some((r) => r.axis === axis.traitKey) },
      ),
    }));
  return { ...read, axes };
}

/** One entry per axis the firm's model enriches (and `include` accepts), with its findings. */
export function planFirmAxes(
  firm: ObjectOf<"Firm">,
  rows: readonly ObjectOf<"Extraction">[],
  newConflictId: () => string,
  include: (axis: TraitDef) => boolean = () => true,
): { axis: TraitDef; plans: FindingPlan[] }[] {
  return planFirm(firm, rows, newConflictId, include).axes;
}
