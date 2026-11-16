/**
 * Deterministic mock data providers. Each firm has a hidden "truth" per
 * axis, and each provider observes it with its own coverage and error rate.
 * Everything is a pure function of (provider, firm, axis), keyed by the firm's
 * seed key, so there is no fixture table and firms discovered later still get data.
 */
import { type EvidenceTrait, optionsFor } from "../../shared/rubric/catalog.js";
import { resolveThesis } from "../../shared/rubric/engine.js";
import { thesisOf } from "../../shared/rubric/firm.js";
import { type Provider } from "../../shared/vocab.js";
import { ADVISORY_ACQUISITIONS as WS } from "../../shared/workspaces/advisoryAcquisitions.js";
import { seedKeyFor } from "../seed/universe.js";
import { gaussian, pick, rng } from "./random.js";

export interface Observation {
  provider: Provider;
  axis: string;
  value: string;
  confidence: number;
  sourceUrl: string;
  sourceExcerpt: string;
  /** Set when the value was extracted from a source document. */
  sourceDocumentId?: string;
  sourceQuote?: string;
  model?: string;
}

export interface FirmRef {
  firmId?: string | null;
  firmName?: string | null;
  firmType?: string | null;
  $primaryKey?: string;
}

export const idOf = (f: FirmRef): string => f.$primaryKey ?? f.firmId ?? "";
/** The key the firm's hidden values are drawn from (its id, unless it was renamed; see seedKeyFor). */
const keyOf = (f: FirmRef): string => seedKeyFor(idOf(f));
const isCs = (f: FirmRef): boolean => thesisKey(f) === "CS";
/** The firm's thesis under the workspace these mocks describe. */
const thesisKey = (f: FirmRef): string =>
  resolveThesis(WS.rubric, thesisOf(f as Readonly<Record<string, unknown>>)).key;
/** A category trait's labels for the firm's thesis, in rubric order. */
const labels = (f: FirmRef, key: string): readonly string[] =>
  optionsFor(
    WS.rubric,
    thesisOf(f as Readonly<Record<string, unknown>>),
    WS.traits.find((t) => t.traitKey === key)!,
  );

export const PROVIDERS: Readonly<
  Record<
    Provider,
    {
      label: string;
      axes: readonly string[];
      coverage: number;
      errorRate: number;
      conf: [number, number];
      host: string;
    }
  >
> = {
  beacondb: {
    label: "BeaconDB",
    axes: ["services_fit", "md_pedigree", "firm_age", "fee_generating_count"],
    coverage: 0.25,
    errorRate: 0.02,
    conf: [0.85, 0.97],
    host: "beacondb.example",
  },
  dealdb: {
    label: "Deal DB",
    axes: [
      "deal_size_usd_m",
      "deals_per_md_l3y",
      "firm_age",
      "fee_generating_count",
      "balance_sheet_principal",
    ],
    coverage: 0.7,
    errorRate: 0.1,
    conf: [0.7, 0.9],
    host: "dealdb.example",
  },
  filings: {
    label: "Filings",
    axes: [
      "advisory_conflict",
      "has_st_or_balance_sheet",
      "solvent",
      "firm_age",
      "balance_sheet_principal",
    ],
    coverage: 0.6,
    errorRate: 0.05,
    conf: [0.75, 0.92],
    host: "filings.example",
  },
  websearch: {
    label: "Web search",
    axes: ["services_fit", "md_pedigree", "web_activity", "deals_per_md_l3y"],
    coverage: 0.55,
    errorRate: 0.2,
    conf: [0.4, 0.75],
    host: "web.example",
  },
};

/** The firm's hidden true value for an axis (what a perfect analyst would find). */
export function truthFor(firm: FirmRef, axis: EvidenceTrait): string {
  const r = rng(`truth|${keyOf(firm)}|${axis.traitKey}`);
  const cs = isCs(firm);
  switch (axis.traitKey) {
    case "services_fit":
      return pick(r, labels(firm, "services_fit"), cs ? [0.15, 0.45, 0.4] : [0.1, 0.5, 0.4]);
    case "md_pedigree":
      return pick(r, labels(firm, "md_pedigree"), [0.15, 0.5, 0.35]);
    case "balance_sheet_principal":
      return pick(r, labels(firm, "balance_sheet_principal"), [0.2, 0.4, 0.4]);
    case "deal_size_usd_m":
      return String(Math.max(5, Math.round(Math.exp(Math.log(60) + 0.8 * gaussian(r)))));
    case "deals_per_md_l3y":
      return (Math.round(r() * 60) / 10).toFixed(1);
    case "firm_age":
      return String(1 + Math.floor(r() * 30));
    case "fee_generating_count":
      return String(1 + Math.floor(r() * 8));
    case "advisory_conflict":
      return r() < 0.12 ? "true" : "false";
    case "has_st_or_balance_sheet":
      return r() < 0.1 ? "true" : "false";
    case "web_activity":
      return r() < 0.85 ? "true" : "false";
    case "solvent":
      return r() < 0.95 ? "true" : "false";
    default:
      throw new Error(`No truth model for axis ${axis.traitKey}`);
  }
}

function wrongValue(firm: FirmRef, axis: EvidenceTrait, truth: string, r: () => number): string {
  if (axis.kind === "yesno") {
    return truth === "true" ? "false" : "true";
  }
  if (axis.kind === "number") {
    const n = Number(truth) * (r() < 0.5 ? 0.4 + r() * 0.4 : 1.3 + r() * 0.6);
    return axis.traitKey === "deals_per_md_l3y" ? n.toFixed(1) : String(Math.max(1, Math.round(n)));
  }
  const options = labels(firm, axis.traitKey);
  return pick(
    r,
    options.filter((l) => l !== truth),
  );
}

/** One provider's raw draw for one firm and axis: the value it reports and how sure it is. */
function draw(
  provider: Provider,
  firm: FirmRef,
  axis: EvidenceTrait,
): { value: string; confidence: number } | null {
  const p = PROVIDERS[provider];
  if (!p.axes.includes(axis.traitKey)) {
    return null;
  }
  const r = rng(`obs|${provider}|${keyOf(firm)}|${axis.traitKey}`);
  if (r() > p.coverage) {
    return null;
  }
  const truth = truthFor(firm, axis);
  const value = r() < p.errorRate ? wrongValue(firm, axis, truth, r) : truth;
  const confidence = Math.round((p.conf[0] + r() * (p.conf[1] - p.conf[0])) * 100) / 100;
  return { value, confidence };
}

/** What one provider reports for one firm and axis, or null if it has nothing. */
export function observe(
  provider: Provider,
  firm: FirmRef,
  axis: EvidenceTrait,
): Observation | null {
  const d = draw(provider, firm, axis);
  if (!d) {
    return null;
  }
  const p = PROVIDERS[provider];
  return {
    provider,
    axis: axis.traitKey,
    value: d.value,
    confidence: d.confidence,
    sourceUrl: `https://${p.host}/firms/${encodeURIComponent(idOf(firm))}#${axis.traitKey}`,
    sourceExcerpt: `${p.label} lists ${axis.traitKey.replace(/_/g, " ")} for ${firm.firmName ?? "this firm"} as "${d.value}".`,
  };
}

/**
 * The confidence `observe` assigns to this provider's answer. Where the
 * provider has nothing for the firm and axis, its midpoint confidence.
 */
export function confidenceFor(provider: Provider, firm: FirmRef, axis: EvidenceTrait): number {
  const d = draw(provider, firm, axis);
  if (d) {
    return d.confidence;
  }
  const [lo, hi] = PROVIDERS[provider].conf;
  // Whole hundredths first, so a .5 midpoint rounds up instead of tripping on float error.
  return Math.round((Math.round(lo * 100) + Math.round(hi * 100)) / 2) / 100;
}
