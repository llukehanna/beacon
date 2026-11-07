/**
 * Where a finding's value came from, as the Desk words it. Pure: no React, no data access. The tear
 * sheet and the MCP server's firm evidence both cite through this one function, so a citation
 * read by an assistant is the one an analyst sees.
 */
import { SYNTHETIC_LABEL } from "../../../shared/marketSignals";
import { MARKET_SIGNAL, providerLabel } from "../../../shared/vocab";
import { type FindingLike } from "../axisState";
import { providerOf } from "./evidenceModel";

/** Where a value came from: enough to look the sentence up again. */
export interface Citation {
  /** The provider's name, "Analyst" for an analyst's own entry. */
  provider: string;
  /** The sentence the value was read from; null when the entry cites none. */
  quote: string | null;
  /** The extraction model that read it; null when no model was involved. */
  model: string | null;
}

export const nonEmpty = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Where a finding's value came from. Only a finding read from a source document has a source
 * sentence, and it is credited to the provider that document belongs to (a corroborated finding
 * carries the lead source's sentence and model, not both providers'). A finding with no document
 * is an analyst's entry: its `sourceExcerpt` holds a note, not a quotation, so it is never cited.
 */
export function citationOf(f: FindingLike): Citation {
  // A market signal is invented news with no document: it is credited as such, never as an analyst.
  if ((f.provider ?? "").trim().toLowerCase() === MARKET_SIGNAL) {
    return { provider: SYNTHETIC_LABEL, quote: null, model: null };
  }
  const documentProvider = providerOf(f.sourceDocumentId);
  if (nonEmpty(f.sourceDocumentId) === null) {
    return { provider: "Analyst", quote: null, model: null };
  }
  const provider = documentProvider ?? nonEmpty(f.provider);
  return {
    provider: provider === null ? "Source document" : providerLabel(provider),
    quote: nonEmpty(f.sourceQuote),
    model: nonEmpty(f.extractionModel),
  };
}
