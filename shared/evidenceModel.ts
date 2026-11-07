/**
 * What the evidence panel shows for one axis: which provider's reading to open, the grounding
 * checks behind it, and the reason text for a reading that was turned down. Pure.
 */
import { type AxisRow, openConflictFindings } from "./axisRows.js";
import { type FindingLike } from "./axisState.js";
import type { ProviderObservation } from "./summaries.js";
import { type AxisDef, PROVIDER_TRUST } from "./vocab.js";

/** Mirrors the server's grounding rule: a shorter quote is a fragment, not a statement. */
const MIN_QUOTE_WORDS = 4;

export interface CheckView {
  id: "verbatim" | "value" | "length";
  label: string;
  status: "pass" | "fail" | "na";
  detail: string | null;
}

/** The three grounding checks for one reading, from the checks the server computed. */
export function evidenceChecks(def: AxisDef, reading: ProviderObservation): CheckView[] {
  const c = reading.checks;
  const found = c !== null && c.line !== null;
  return [
    {
      id: "verbatim",
      label: "Quote found verbatim in source",
      status: found ? "pass" : "fail",
      detail: found ? `line ${c.line}` : "not found",
    },
    def.kind === "gate"
      ? {
          id: "value",
          label: "Value appears in the quote",
          status: "na",
          detail: "not required for gates",
        }
      : {
          id: "value",
          label: "Value appears in the quote",
          status: !found ? "na" : c.valueInQuote ? "pass" : "fail",
          detail: found && reading.value !== null ? `"${reading.value}"` : null,
        },
    {
      id: "length",
      label: "Quote long enough to stand alone",
      status: !found ? "na" : c.words >= MIN_QUOTE_WORDS ? "pass" : "fail",
      detail: found ? `${c.words} words` : null,
    },
  ];
}

/** The provider a source document belongs to ("dealdb:acme" is Deal DB's); null when there is none. */
export const providerOf = (documentId: string | null | undefined): string | null => {
  const at = (documentId ?? "").indexOf(":");
  return at > 0 ? (documentId as string).slice(0, at) : null;
};

/**
 * The reading to open first: the one the finding cites, else the first kept one, else the first
 * that said anything. Undefined when no provider said anything.
 */
export function pickReading(
  row: Pick<AxisRow, "readings">,
  finding: Pick<FindingLike, "sourceDocumentId"> | undefined,
): ProviderObservation | undefined {
  const said = row.readings.filter((r) => r.value !== null);
  const cited = providerOf(finding?.sourceDocumentId);
  return (
    said.find((r) => cited !== null && r.provider === cited) ??
    said.find((r) => r.grounded === true) ??
    said[0]
  );
}

const REASON_TEXT: Record<string, string> = {
  quote_not_in_document: "The quote is not in the source document.",
  quote_too_short: "The quote is too short to stand on its own.",
  value_not_in_quote: "The quote does not contain the value.",
  invalid_value: "The value is not valid for this axis.",
  axis_not_covered: "This source does not cover the axis.",
};

/** A grounding rejection reason as a sentence; an unfamiliar reason is shown as it came. */
export function rejectReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason;
}

/**
 * True when the finding speaking for an axis cites no source document (an analyst's entry): no
 * provider's document or checks may be shown under it. An abstention has none either, but there
 * the provider readings are exactly what the panel explains, so it is not "entered".
 */
export function isAnalystEntered(
  state: AxisRow["state"],
  finding: Pick<FindingLike, "sourceDocumentId"> | undefined,
): boolean {
  return finding !== undefined && state !== "abstained" && !finding.sourceDocumentId;
}

const trustIndex = (f: Pick<FindingLike, "provider">): number => {
  const i = PROVIDER_TRUST.findIndex((p) => p === f.provider);
  return i < 0 ? PROVIDER_TRUST.length : i;
};

/** The sides of an open conflict as the evidence panel lists them: the two most trusted sources. */
export function conflictSides(row: Pick<AxisRow, "findings">): FindingLike[] {
  return [...openConflictFindings(row)].sort((a, b) => trustIndex(a) - trustIndex(b)).slice(0, 2);
}
