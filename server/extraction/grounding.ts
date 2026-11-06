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
  | "quote_not_in_document"
  | "quote_too_short"
  | "value_not_in_quote"
  | "invalid_value"
  | "axis_not_covered";

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

/**
 * Whitespace-collapsed text, with `rawStart[i]` the raw index of collapsed character i.
 * A collapsed space maps to the start of its whitespace run.
 */
function collapseWithMap(raw: string): { text: string; rawStart: number[] } {
  let text = "";
  const rawStart: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      if (pendingSpace < 0) {
        pendingSpace = i;
      }
      continue;
    }
    if (pendingSpace >= 0 && text !== "") {
      text += " ";
      rawStart.push(pendingSpace);
    }
    pendingSpace = -1;
    text += raw[i];
    rawStart.push(i);
  }
  return { text, rawStart };
}

/** The exact slice of `raw` that matches `quote` once whitespace is collapsed, or null. */
function rawSlice(raw: string, quote: string): string | null {
  const { text, rawStart } = collapseWithMap(raw);
  const at = text.indexOf(quote);
  if (at < 0) {
    return null;
  }
  return raw.slice(rawStart[at], rawStart[at + quote.length - 1] + 1);
}

/** A quote shorter than this many words is a fragment, not a sentence that states a fact. */
const MIN_QUOTE_WORDS = 4;
/** Words in a quote, the length measure grounding applies. */
export const quoteWordCount = (s: string): number => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/**
 * Standalone numbers: not glued to letters, decimals, or thousands separators, so "$85" yields
 * 85, "1,200" yields none, and "In 2019, the firm" still yields 2019.
 */
const NUMBER_TOKEN = /(?<![\w.]|\d,)\d+(?:\.\d+)?(?![\w]|,\d|\.\d)/g;

const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

function quoteHasNumber(quote: string, value: number): boolean {
  return (quote.match(NUMBER_TOKEN) ?? []).some((t) => Number(t) === value);
}

/**
 * Whether an accepted value appears in its quote: the label for a categorical axis, the number
 * for a numeric one, the word true or false (as a whole word) for a gate.
 */
export function valueInQuote(axis: AxisDef, value: string, quote: string): boolean {
  if (axis.kind === "number") {
    return quoteHasNumber(quote, Number(value));
  }
  if (axis.kind === "gate") {
    return quote
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .includes(value.trim().toLowerCase());
  }
  return quote.toLowerCase().includes(value.toLowerCase());
}

/** The canonical string for an accepted value, or null when the value is not valid for the axis. */
function validValue(firm: FirmRef, axis: AxisDef, raw: string): string | null {
  if (axis.kind === "number" && !PLAIN_NUMBER.test(raw.trim())) {
    return null;
  }
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

    const modelQuote = item.quote === null ? "" : collapse(item.quote);
    const quote = modelQuote === "" ? null : rawSlice(doc.body, modelQuote);
    if (quote === null) {
      reject("quote_not_in_document");
      continue;
    }
    if (quoteWordCount(quote) < MIN_QUOTE_WORDS) {
      reject("quote_too_short");
      continue;
    }

    if (!valueInQuote(axis, value, quote)) {
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
