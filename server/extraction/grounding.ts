/**
 * Grounding: keep only extracted values the source documents support.
 * The check is "the document says this", not "this matches our answer key".
 * Pure: no DB, no network.
 */
import { parseAxisValue } from "../../shared/scoring.js";
import {
  type AxisDef,
  CF_MD_LABELS,
  CF_SERVICES_LABELS,
  CS_BSP_LABELS,
  CS_MD_LABELS,
  CS_SERVICES_LABELS,
  type Provider,
  axisByName,
} from "../../shared/vocab.js";
import {
  type FirmRef,
  type Observation,
  PROVIDERS,
  confidenceFor,
} from "../enrichment/providers.js";
import type { ExtractionOutput } from "./contract.js";
import type { SourceDocument } from "./documents.js";

export type RejectReason =
  "quote_not_in_document" | "value_not_in_quote" | "invalid_value" | "axis_not_covered";

export interface GroundingResult {
  observations: Observation[];
  rejected: { provider: Provider; axis: string; reason: RejectReason }[];
}

const isCs = (f: FirmRef): boolean => (f.firmType ?? "").toLowerCase() === "cs";

/** Allowed labels for a categorical axis, by the firm's model. */
function labelsFor(firm: FirmRef, axis: AxisDef): readonly string[] {
  const cs = isCs(firm);
  switch (axis.axis) {
    case "services_fit":
      return cs ? CS_SERVICES_LABELS : CF_SERVICES_LABELS;
    case "md_pedigree":
      return cs ? CS_MD_LABELS : CF_MD_LABELS;
    case "balance_sheet_principal":
      return CS_BSP_LABELS;
    default:
      return [];
  }
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Standalone numbers: not glued to letters or digits, so "$85" yields 85 but never 5. */
const NUMBER_TOKEN = /(?<![\w.])\d+(?:\.\d+)?(?!\w)/g;

function quoteHasNumber(quote: string, value: number): boolean {
  return (quote.match(NUMBER_TOKEN) ?? []).some((t) => Number(t) === value);
}

/** The canonical string for an accepted value, or null when the value is not valid for the axis. */
function validValue(firm: FirmRef, axis: AxisDef, raw: string): string | null {
  const parsed = parseAxisValue(axis, raw);
  if (parsed === null) {
    return null;
  }
  if (axis.kind === "enum") {
    return labelsFor(firm, axis).includes(String(parsed)) ? String(parsed) : null;
  }
  // Numbers keep the digits as written ("4.0" stays "4.0"); gates normalise to true/false.
  return axis.kind === "number" ? raw.trim() : String(parsed);
}

export function groundExtraction(
  firm: FirmRef,
  docs: readonly SourceDocument[],
  output: ExtractionOutput,
  model: string,
): GroundingResult {
  const observations: Observation[] = [];
  const rejected: GroundingResult["rejected"] = [];
  const seen = new Set<string>();

  for (const item of output.items) {
    if (item.value === null) {
      continue;
    }
    const { provider, axis: axisName } = item;
    const reject = (reason: RejectReason): void => {
      rejected.push({ provider, axis: axisName, reason });
    };

    const doc = docs.find((d) => d.provider === provider);
    const axis = axisByName(axisName);
    if (!doc || !axis || !PROVIDERS[provider].axes.includes(axis.axis)) {
      reject("axis_not_covered");
      continue;
    }

    const value = validValue(firm, axis, item.value);
    if (value === null) {
      reject("invalid_value");
      continue;
    }

    const quote = item.quote === null ? "" : collapse(item.quote);
    if (quote === "" || !collapse(doc.body).includes(quote)) {
      reject("quote_not_in_document");
      continue;
    }

    if (axis.kind === "enum" && !quote.toLowerCase().includes(value.toLowerCase())) {
      reject("value_not_in_quote");
      continue;
    }
    if (axis.kind === "number" && !quoteHasNumber(quote, Number(value))) {
      reject("value_not_in_quote");
      continue;
    }

    const key = `${provider}|${axis.axis}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    observations.push({
      provider,
      axis: axis.axis,
      value,
      confidence: confidenceFor(provider, firm, axis),
      sourceUrl: "",
      sourceExcerpt: quote,
      sourceDocumentId: doc.documentId,
      sourceQuote: quote,
      model,
    });
  }
  return { observations, rejected };
}
