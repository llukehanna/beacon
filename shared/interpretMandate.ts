// Reads a mandate's free text and says which search filters it implies. Deterministic: a
// vocabulary built from the facet lists the search page already offers, plus a small synonym table
// for the ways analysts actually write them. Nothing here calls a model, and nothing maps to a
// value the vocabulary does not contain.
import { type FacetGroup, INDUSTRY_GROUPS, PRODUCT_GROUPS, REGIONS } from "./taxonomy.js";

export interface MandateMatch {
  /** The words in the mandate text, as written. */
  phrase: string;
  /** The search-page facet key this sets. */
  facet: string;
  /** The facet option it selects. */
  value: string;
}

export interface Interpretation {
  matches: MandateMatch[];
  /** Notable phrases the text uses that no filter covers (a size band, for one). May be empty. */
  unmatched: string[];
}

export interface MandateFacet {
  facet: string;
  groups: readonly FacetGroup[];
}

export interface MandateVocabulary {
  facets: readonly MandateFacet[];
}

export const FACET_GEOGRAPHIES = "geographies";
export const FACET_PRODUCTS = "products";
export const FACET_INDUSTRIES = "industries";

/** The facets SearchPage offers, from the taxonomy it renders. */
export function searchVocabulary(): MandateVocabulary {
  return {
    facets: [
      { facet: FACET_GEOGRAPHIES, groups: REGIONS },
      { facet: FACET_PRODUCTS, groups: PRODUCT_GROUPS },
      { facet: FACET_INDUSTRIES, groups: INDUSTRY_GROUPS },
    ],
  };
}

// Other ways to write an option. An entry whose value is not in the vocabulary is ignored, so this
// table can never widen what a mandate may select.
const SYNONYMS: ReadonlyArray<readonly [phrase: string, facet: string, value: string]> = [
  ["north america", FACET_GEOGRAPHIES, "Americas"],
  ["north american", FACET_GEOGRAPHIES, "Americas"],
  ["latin america", FACET_GEOGRAPHIES, "Americas"],
  ["european", FACET_GEOGRAPHIES, "Europe"],
  ["emea", FACET_GEOGRAPHIES, "Europe"],
  ["middle east", FACET_GEOGRAPHIES, "Middle East & Africa"],
  ["africa", FACET_GEOGRAPHIES, "Middle East & Africa"],
  ["asia pacific", FACET_GEOGRAPHIES, "Asia-Pacific"],
  ["apac", FACET_GEOGRAPHIES, "Asia-Pacific"],
  ["asia", FACET_GEOGRAPHIES, "Asia-Pacific"],
  ["u.s.", FACET_GEOGRAPHIES, "United States"],
  ["usa", FACET_GEOGRAPHIES, "United States"],
  ["uk", FACET_GEOGRAPHIES, "United Kingdom"],
  ["britain", FACET_GEOGRAPHIES, "United Kingdom"],
  ["uae", FACET_GEOGRAPHIES, "United Arab Emirates"],

  ["m&a", FACET_PRODUCTS, "Corporate Finance"],
  ["mergers and acquisitions", FACET_PRODUCTS, "Corporate Finance"],
  ["mid-market advisory", FACET_PRODUCTS, "Corporate Finance"],
  ["sell side", FACET_PRODUCTS, "Sell-side M&A"],
  ["sell-side", FACET_PRODUCTS, "Sell-side M&A"],
  ["buy side", FACET_PRODUCTS, "Buy-side M&A"],
  ["buy-side", FACET_PRODUCTS, "Buy-side M&A"],
  ["sector-focused", FACET_PRODUCTS, "Sector-focused M&A"],
  ["special committee", FACET_PRODUCTS, "Board & special committee advisory"],
  ["credit", FACET_PRODUCTS, "Capital Solutions"],
  ["private capital", FACET_PRODUCTS, "Capital Solutions"],
  ["debt advisory", FACET_PRODUCTS, "Capital Solutions"],
  ["capital raising", FACET_PRODUCTS, "Capital Solutions"],
  ["asset-based finance", FACET_PRODUCTS, "Structured & asset-based finance"],
  ["private placement", FACET_PRODUCTS, "Equity private placements"],
  ["private placements", FACET_PRODUCTS, "Equity private placements"],
  ["secondaries", FACET_PRODUCTS, "Secondaries & GP advisory"],

  ["tech", FACET_INDUSTRIES, "Technology"],
  ["saas", FACET_INDUSTRIES, "Software"],
  ["health care", FACET_INDUSTRIES, "Healthcare"],
  ["industrial", FACET_INDUSTRIES, "Energy & Industrials"],
  ["industrials", FACET_INDUSTRIES, "Energy & Industrials"],
  ["banks", FACET_INDUSTRIES, "Banking"],
  ["defense", FACET_INDUSTRIES, "Aerospace & Defense"],
  ["defence", FACET_INDUSTRIES, "Aerospace & Defense"],
  ["pharma", FACET_INDUSTRIES, "Pharma Services"],
];

// Phrases worth telling the analyst about because they carry meaning no filter on the page holds.
const NOTABLE_UNMAPPED: readonly string[] = [
  "lower mid-market",
  "upper mid-market",
  "middle market",
  "mid-market",
  "large-cap",
  "small-cap",
  "cross-border",
];

interface Term {
  phrase: string;
  facet: string;
  value: string;
}

const WORD_CHAR = "\\p{L}\\p{N}";
const GAP = "[\\s\\-\\u2010-\\u2015]+";

/** A case-insensitive, word-bounded pattern where spaces and hyphens in `phrase` may be either. */
function phrasePattern(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/[\s-]+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(GAP);
  return new RegExp(`(?<![${WORD_CHAR}])${body}(?![${WORD_CHAR}])`, "iu");
}

function termsFor(vocabulary: MandateVocabulary): Term[] {
  const terms: Term[] = [];
  const known = new Map<string, string>(); // facet + lowercased value -> canonical value
  for (const { facet, groups } of vocabulary.facets) {
    for (const group of groups) {
      for (const label of [group.label, ...group.subs]) {
        terms.push({ phrase: label, facet, value: label });
        known.set(`${facet}\u0000${label.toLowerCase()}`, label);
      }
    }
  }
  for (const [phrase, facet, value] of SYNONYMS) {
    const canonical = known.get(`${facet}\u0000${value.toLowerCase()}`);
    if (canonical !== undefined) {
      terms.push({ phrase, facet, value: canonical });
    }
  }
  return terms;
}

interface Span {
  start: number;
  end: number;
}

const overlaps = (taken: readonly Span[], s: Span): boolean =>
  taken.some((t) => s.start < t.end && t.start < s.end);

/** Reads the text against the vocabulary: longest phrase first, each phrase and span used once. */
export function interpretMandate(text: string, vocabulary: MandateVocabulary): Interpretation {
  const taken: Span[] = [];
  const found: Array<MandateMatch & { start: number }> = [];

  const byLength = [...termsFor(vocabulary)].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const term of byLength) {
    // A phrase may occur more than once; only a free occurrence counts, and only the first.
    const pattern = new RegExp(phrasePattern(term.phrase), "giu");
    for (const m of text.matchAll(pattern)) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (overlaps(taken, span)) {
        continue;
      }
      taken.push(span);
      found.push({ phrase: m[0], facet: term.facet, value: term.value, start: span.start });
      break;
    }
  }

  const unmatched: string[] = [];
  for (const phrase of NOTABLE_UNMAPPED) {
    const pattern = new RegExp(phrasePattern(phrase), "giu");
    for (const m of text.matchAll(pattern)) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (overlaps(taken, span)) {
        continue;
      }
      taken.push(span);
      unmatched.push(m[0]);
      break;
    }
  }

  // Two phrases can name one option ("Europe", "European"); the one written first stands for it.
  found.sort((a, b) => a.start - b.start);
  const matches = found
    .filter((f, i) => found.findIndex((g) => g.facet === f.facet && g.value === f.value) === i)
    .map(({ phrase, facet, value }) => ({ phrase, facet, value }));
  return {
    matches,
    unmatched,
  };
}
