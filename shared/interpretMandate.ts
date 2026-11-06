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
const SYNONYMS: ReadonlyArray<readonly [phrase: string, facet: string, ...values: string[]]> = [
  // North America is the two countries of the Americas list that are in it, not the whole region.
  ["north america", FACET_GEOGRAPHIES, "United States", "Canada"],
  ["north american", FACET_GEOGRAPHIES, "United States", "Canada"],
  ["latin america", FACET_GEOGRAPHIES, "Mexico", "Brazil"],
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
  /** What the phrase selects: usually one option, two for "North America". */
  targets: Array<{ facet: string; value: string }>;
}

const WORD_CHAR = "\\p{L}\\p{N}";
const GAP = "[\\s\\-\\u2010-\\u2015]+";

interface Span {
  start: number;
  end: number;
}

/**
 * Where `phrase` occurs in `text`, whole words only, case-insensitive; spaces and hyphens in the
 * phrase may be either. The leading boundary is a captured character rather than a lookbehind,
 * which Safari 16.0 to 16.3 cannot parse.
 */
function occurrences(text: string, phrase: string): Span[] {
  const body = phrase
    .trim()
    .split(/[\s-]+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(GAP);
  const pattern = new RegExp(`(^|[^${WORD_CHAR}])(${body})(?![${WORD_CHAR}])`, "giu");
  return [...text.matchAll(pattern)].map((m) => {
    const start = m.index + m[1].length;
    return { start, end: start + m[2].length };
  });
}

function termsFor(vocabulary: MandateVocabulary): Term[] {
  const terms: Term[] = [];
  const known = new Map<string, string>(); // facet + lowercased value -> canonical value
  for (const { facet, groups } of vocabulary.facets) {
    for (const group of groups) {
      for (const label of [group.label, ...group.subs]) {
        terms.push({ phrase: label, targets: [{ facet, value: label }] });
        known.set(`${facet}\u0000${label.toLowerCase()}`, label);
      }
    }
  }
  for (const [phrase, facet, ...values] of SYNONYMS) {
    const targets = values.flatMap((value) => {
      const canonical = known.get(`${facet}\u0000${value.toLowerCase()}`);
      return canonical === undefined ? [] : [{ facet, value: canonical }];
    });
    if (targets.length > 0) {
      terms.push({ phrase, targets });
    }
  }
  return terms;
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
    const span = occurrences(text, term.phrase).find((o) => !overlaps(taken, o));
    if (span === undefined) {
      continue;
    }
    taken.push(span);
    const phrase = text.slice(span.start, span.end);
    for (const { facet, value } of term.targets) {
      found.push({ phrase, facet, value, start: span.start });
    }
  }

  const unmatched: string[] = [];
  for (const phrase of NOTABLE_UNMAPPED) {
    const span = occurrences(text, phrase).find((o) => !overlaps(taken, o));
    if (span !== undefined) {
      taken.push(span);
      unmatched.push(text.slice(span.start, span.end));
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
