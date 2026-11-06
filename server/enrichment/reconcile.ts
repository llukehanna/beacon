import { type AxisDef, PROVIDER_TRUST } from "../../shared/vocab.js";
import type { Observation } from "./providers.js";

export interface FindingPlan {
  axis: string;
  value: string | null;
  provider: string;
  sourceType: string;
  sourceUrl: string | null;
  sourceExcerpt: string;
  sourceDocumentId: string | null;
  sourceQuote: string | null;
  extractionModel: string | null;
  confidence: number;
  confidenceTier: "high" | "low" | "abstain";
  findingStatus: "proposed" | "abstained";
  conflictGroupId: string | null;
}

const SOURCE_TYPE: Readonly<Record<string, string>> = {
  beacondb: "internal",
  dealdb: "database",
  filings: "regulatory_filing",
  websearch: "web",
};

/** Abstention excerpt when the model answered but no quote in the source supported it. */
export const UNGROUNDED_EXCERPT =
  "The model's answer for this axis was not supported by a quote in the source, so Beacon recorded no value.";

/** A single source at or above this confidence is "high" without corroboration. */
export const HIGH_CONFIDENCE = 0.8;

export function sameValue(axis: AxisDef, a: string, b: string): boolean {
  if (axis.kind === "number") {
    return Number(a) === Number(b);
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Turn one axis's observations into findings: abstain when nobody knows,
 * corroborate when sources agree, and surface a conflict pair (the two most
 * trusted positions) when they don't. Never picks a winner in a conflict.
 */
export function reconcileAxis(
  axis: AxisDef,
  observations: readonly Observation[],
  newConflictId: () => string,
  opts: { groundingRejected?: boolean } = {},
): FindingPlan[] {
  if (observations.length === 0) {
    return [
      {
        axis: axis.axis,
        value: null,
        provider: "agent",
        sourceType: "agent",
        sourceUrl: null,
        sourceExcerpt: opts.groundingRejected
          ? UNGROUNDED_EXCERPT
          : "No source returned a value for this axis.",
        sourceDocumentId: null,
        sourceQuote: null,
        extractionModel: null,
        confidence: 0,
        confidenceTier: "abstain",
        findingStatus: "abstained",
        conflictGroupId: null,
      },
    ];
  }
  const ordered = [...observations].sort(
    (a, b) => PROVIDER_TRUST.indexOf(a.provider) - PROVIDER_TRUST.indexOf(b.provider),
  );
  const groups: Observation[][] = [];
  for (const o of ordered) {
    const g = groups.find((grp) => sameValue(axis, grp[0].value, o.value));
    if (g) {
      g.push(o);
    } else {
      groups.push([o]);
    }
  }
  const toPlan = (g: readonly Observation[], conflictGroupId: string | null): FindingPlan => {
    const lead = g[0];
    const confidence = Math.max(...g.map((o) => o.confidence));
    return {
      axis: axis.axis,
      value: lead.value,
      provider: g.map((o) => o.provider).join("+"),
      sourceType: SOURCE_TYPE[lead.provider],
      sourceUrl: lead.sourceDocumentId ? null : lead.sourceUrl,
      sourceExcerpt: lead.sourceExcerpt,
      sourceDocumentId: lead.sourceDocumentId ?? null,
      sourceQuote: lead.sourceQuote ?? null,
      extractionModel: lead.model ?? null,
      confidence,
      confidenceTier:
        conflictGroupId === null && (g.length > 1 || confidence >= HIGH_CONFIDENCE)
          ? "high"
          : "low",
      findingStatus: "proposed",
      conflictGroupId,
    };
  };
  if (groups.length === 1) {
    return [toPlan(groups[0], null)];
  }
  const id = newConflictId();
  return groups.slice(0, 2).map((g) => toPlan(g, id));
}
