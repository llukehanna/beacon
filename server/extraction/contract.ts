/**
 * The extraction contract: the prompt, its input, and its output shape, kept in
 * one pure module (no DB, no network) so it can be mirrored by a hosted function.
 * A model reads a firm's four source documents and returns, per axis, a value
 * plus a verbatim quote; `grounding.ts` rejects anything the documents do not support.
 */
import { z } from "zod";
import {
  CF_MD_LABELS,
  CF_SERVICES_LABELS,
  CS_BSP_LABELS,
  CS_MD_LABELS,
  CS_SERVICES_LABELS,
  ENRICH_AXES,
  PROVIDER_TRUST,
  type Provider,
} from "../../shared/vocab.js";
import type { SourceDocument } from "./documents.js";

/** Bump when the prompt or output shape changes: stored extractions become stale. */
export const EXTRACTION_PROMPT_VERSION = "extract-v1";

/** Model name recorded for the deterministic fallback extractor. */
export const RULE_BASED_MODEL = "rule-based";

export interface ExtractedItem {
  provider: Provider;
  axis: string;
  value: string | null;
  quote: string | null;
}

export interface ExtractionOutput {
  items: ExtractedItem[];
}

const AXIS_NAMES: Readonly<Record<string, string>> = {
  services_fit: "Service offering",
  md_pedigree: "Managing directors' backgrounds",
  balance_sheet_principal: "Principal / balance-sheet activity",
  deal_size_usd_m: "Typical deal size, in US$ millions",
  deals_per_md_l3y: "Closed deals per managing director per year, last three years",
  firm_age: "Firm age, in years",
  fee_generating_count: "Number of fee-generating professionals",
  advisory_conflict: "Has a conflicting advisory relationship",
  has_st_or_balance_sheet: "Runs a sales-and-trading desk or a balance sheet",
  web_activity: "Shows recent public web activity",
  solvent: "Is solvent",
};

const list = (labels: readonly string[]): string => labels.map((l) => `    - ${l}`).join("\n");

const axisLines = (): string =>
  ENRICH_AXES.map((a) => {
    const kind =
      a.kind === "number"
        ? "a number, as plain digits (for example 12 or 4.3)"
        : a.kind === "gate"
          ? "the word true or false"
          : "one of the allowed labels below";
    return `- ${a.axis}: ${AXIS_NAMES[a.axis]}. Value: ${kind}.`;
  }).join("\n");

export const SYSTEM_PROMPT = `You extract structured facts about an advisory firm from up to four mock source documents. Each document comes from a different provider and is wrapped in a <document provider="..."> tag. Provider ids: ${PROVIDER_TRUST.join(", ")}.

For every document, report each axis it states. Report only what the document itself says. Do not combine documents, infer, or use outside knowledge. If a document does not state an axis, report that axis with value null and quote null, or leave it out.

Axes:
${axisLines()}

Allowed labels for the categorical axes. Use a label exactly as it appears in the document; the firm's model decides which list applies.
services_fit:
${list(CF_SERVICES_LABELS)}
${list(CS_SERVICES_LABELS)}
md_pedigree:
${list(CF_MD_LABELS)}
${list(CS_MD_LABELS)}
balance_sheet_principal:
${list(CS_BSP_LABELS)}

Rules:
- "quote" must be copied exactly from that document, character for character: one sentence that states the value. Never paraphrase, shorten inside a sentence, or merge sentences.
- "value" must appear in or be directly stated by the quote.
- Numbers are plain digits with no units, currency symbols, or thousands separators. Gates are true or false.
- "provider" is the id from the document tag, and "axis" is one of the axis ids above.

Reply with JSON only, in this shape:
{"items":[{"provider":"dealdb","axis":"firm_age","value":"12","quote":"The firm has been operating for 12 years."}]}`;

/** Each document fenced with its provider id, in the order given. */
export function buildUserMessage(docs: readonly SourceDocument[]): string {
  return docs
    .map((d) => `<document provider="${d.provider}">\n${d.title}\n${d.body}\n</document>`)
    .join("\n\n");
}

const PROVIDER_IDS: ReadonlySet<string> = new Set(PROVIDER_TRUST);
const AXIS_IDS: ReadonlySet<string> = new Set(ENRICH_AXES.map((a) => a.axis));

const nullableText = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

const itemSchema = z.object({
  provider: z.string(),
  axis: z.string(),
  value: nullableText,
  quote: nullableText,
});

const replySchema = z.object({ items: z.array(z.unknown()) });

/**
 * Parse a model reply. Accepts bare JSON or JSON inside a ```json fence.
 * Items with an unknown provider or axis, or a malformed shape, are dropped.
 * Returns null when the text is not JSON of the expected top-level shape.
 */
export function parseExtraction(text: string): ExtractionOutput | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced ? fenced[1] : text).trim();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const reply = replySchema.safeParse(json);
  if (!reply.success) {
    return null;
  }
  const items: ExtractedItem[] = [];
  for (const candidate of reply.data.items) {
    const item = itemSchema.safeParse(candidate);
    if (!item.success) {
      continue;
    }
    const { provider, axis, value, quote } = item.data;
    if (PROVIDER_IDS.has(provider) && AXIS_IDS.has(axis)) {
      items.push({ provider: provider as Provider, axis, value, quote });
    }
  }
  return { items };
}

/** The deterministic fallback: every field the documents state, quoting its own sentence. */
export function ruleBasedExtraction(docs: readonly SourceDocument[]): ExtractionOutput {
  return {
    items: docs.flatMap((d) =>
      d.fields.map((f) => ({
        provider: d.provider,
        axis: f.axis,
        value: f.value,
        quote: f.sentence,
      })),
    ),
  };
}
