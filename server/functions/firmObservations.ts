/**
 * What each provider said about a firm, axis by axis, and whether the quote behind it held up.
 * Stored findings keep only the reconciled result, so this recomputes the readings with the same
 * code the agent runs (`groundFirm`): same documents, same extraction, same grounding. Read-only.
 */
import type { ObjectOf } from "../../shared/schema.js";
import { firmModel } from "../../shared/scoring.js";
import type {
  FirmObservations,
  GroundingChecks,
  ProviderObservation,
} from "../../shared/summaries.js";
import { ENRICH_AXES, PROVIDER_TRUST } from "../../shared/vocab.js";
import { type Access, NO_WALL, isHidden } from "../access.js";
import type { Queryable } from "../db/client.js";
import { getObject, listAll } from "../db/repo.js";
import { HIGH_CONFIDENCE } from "../enrichment/reconcile.js";
import { HttpError } from "../errors.js";
import { type SourceDocument } from "../extraction/documents.js";
import { quoteWordCount, valueInQuote } from "../extraction/grounding.js";
import { groundFirm } from "../extraction/plan.js";

export type { FirmObservations, GroundingChecks, ProviderObservation };

/** Where the quote sits in the document and whether it supports the value; null when not found. */
function checksFor(
  doc: SourceDocument | undefined,
  axis: (typeof ENRICH_AXES)[number],
  value: string,
  quote: string | null,
): GroundingChecks | null {
  if (!doc || quote === null) {
    return null;
  }
  const at = doc.body.indexOf(quote);
  if (at < 0) {
    return null;
  }
  return {
    line: doc.body.slice(0, at).split("\n").length,
    valueInQuote: valueInQuote(axis, value, quote),
    words: quoteWordCount(quote),
  };
}

/**
 * Every provider's reading of every axis the firm's model enriches. A provider with a kept value
 * carries its confidence tier and checks; one whose answer grounding turned down carries what it
 * said and the reason; one with nothing is all null.
 */
export function observeFirm(
  firm: ObjectOf<"Firm">,
  rows: readonly ObjectOf<"Extraction">[],
): FirmObservations {
  const { docs, extraction, grounded } = groundFirm(firm, rows);
  const model = firmModel(firm);
  const hitsByProvider: Record<string, number> = Object.fromEntries(
    PROVIDER_TRUST.map((p) => [p, 0]),
  );
  const axes = ENRICH_AXES.filter((a) => a.models.includes(model)).map((axis) => {
    const providers = PROVIDER_TRUST.map((provider): ProviderObservation => {
      const doc = docs.find((d) => d.provider === provider);
      const kept = grounded.observations.find(
        (o) => o.provider === provider && o.axis === axis.axis,
      );
      if (kept) {
        hitsByProvider[provider] += 1;
        return {
          provider,
          value: kept.value,
          confidence: kept.confidence >= HIGH_CONFIDENCE ? "high" : "low",
          grounded: true,
          rejectReason: null,
          quote: kept.sourceQuote ?? null,
          documentId: kept.sourceDocumentId ?? null,
          checks: checksFor(doc, axis, kept.value, kept.sourceQuote ?? null),
        };
      }
      const rejection = grounded.rejected.find(
        (r) => r.provider === provider && r.axis === axis.axis,
      );
      const said = extraction.output.items.find(
        (i) => i.provider === provider && i.axis === axis.axis && i.value !== null,
      );
      if (rejection && said) {
        return {
          provider,
          value: said.value,
          confidence: null,
          grounded: false,
          rejectReason: rejection.reason,
          quote: said.quote,
          documentId: doc?.documentId ?? null,
          checks: checksFor(doc, axis, said.value ?? "", said.quote),
        };
      }
      return {
        provider,
        value: null,
        confidence: null,
        grounded: null,
        rejectReason: null,
        quote: null,
        documentId: null,
        checks: null,
      };
    });
    return { axis: axis.axis, providers };
  });
  return { firmId: firm.$primaryKey, model: extraction.model, axes, hitsByProvider };
}

export async function firmObservations(
  q: Queryable,
  params: Record<string, unknown>,
  access: Access = NO_WALL,
): Promise<FirmObservations> {
  const { firmId } = params;
  if (typeof firmId !== "string" || firmId === "") {
    throw new HttpError("firmId is required", 400);
  }
  const firm = await getObject(q, "Firm", firmId);
  // A firm the persona may not see is as absent as one that does not exist.
  if (firm === null || isHidden(access, "Firm", firm)) {
    throw new HttpError(`Firm ${firmId} not found`, 404);
  }
  const rows = await listAll(q, "Extraction", { where: { firmId: { $eq: firmId } } });
  return observeFirm(firm, rows);
}
