/**
 * Search facets and the country → geography map. One source for the
 * SearchPage chips, the server's search matching, and the seed generator.
 * Generic by design: nothing here is copied from any real firm's site.
 */
import { resolveThesis } from "./rubric/engine.js";
import type { RubricDefinition } from "./rubric/types.js";

export interface FacetGroup {
  label: string;
  subs: readonly string[];
}

export const REGIONS: readonly FacetGroup[] = [
  { label: "Americas", subs: ["United States", "Canada", "Mexico", "Brazil"] },
  {
    label: "Europe",
    subs: [
      "United Kingdom",
      "Germany",
      "France",
      "Netherlands",
      "Switzerland",
      "Sweden",
      "Spain",
      "Italy",
    ],
  },
  {
    label: "Middle East & Africa",
    subs: ["United Arab Emirates", "Saudi Arabia", "South Africa", "Nigeria"],
  },
  { label: "Asia-Pacific", subs: ["Australia", "Japan", "Singapore", "India", "Hong Kong"] },
];

export const PRODUCT_GROUPS: readonly FacetGroup[] = [
  {
    label: "Corporate Finance",
    subs: [
      "Sell-side M&A",
      "Buy-side M&A",
      "Sector-focused M&A",
      "Board & special committee advisory",
    ],
  },
  {
    label: "Capital Solutions",
    subs: [
      "Private credit advisory",
      "Structured & asset-based finance",
      "Equity private placements",
      "Secondaries & GP advisory",
    ],
  },
];

export const INDUSTRY_GROUPS: readonly FacetGroup[] = [
  {
    label: "Business Services",
    subs: ["IT Services", "Marketing Services", "Logistics", "Professional Services"],
  },
  { label: "Consumer", subs: ["Food & Beverage", "Retail", "Leisure"] },
  { label: "Energy & Industrials", subs: ["Energy", "Manufacturing", "Aerospace & Defense"] },
  { label: "Financial Services", subs: ["Banking", "Insurance", "Asset Management"] },
  { label: "Healthcare", subs: ["Healthcare Services", "Medical Devices", "Pharma Services"] },
  { label: "Technology", subs: ["Software", "FinTech", "Data & Analytics"] },
];

export const ALL_SECTORS: readonly string[] = INDUSTRY_GROUPS.flatMap((g) => g.subs);

export interface CountryGeo {
  region: string;
  /** Firm.geography bucket the UI groups by. */
  bucket: "US" | "EUR" | "Other";
  /** Firm.geographicFootprint: descriptive only in rubric v2. */
  footprint: string;
  /** The geo_score trait it gives a firm: US/UK = 2, developed = 1, else 0. */
  fit: 0 | 1 | 2;
}

export const COUNTRY_GEO: Readonly<Record<string, CountryGeo>> = {
  "United States": { region: "Americas", bucket: "US", footprint: "US", fit: 2 },
  Canada: { region: "Americas", bucket: "Other", footprint: "Developed", fit: 1 },
  Mexico: { region: "Americas", bucket: "Other", footprint: "Emerging", fit: 0 },
  Brazil: { region: "Americas", bucket: "Other", footprint: "Emerging", fit: 0 },
  "United Kingdom": { region: "Europe", bucket: "EUR", footprint: "UK", fit: 2 },
  Germany: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  France: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  Netherlands: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  Switzerland: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  Sweden: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  Spain: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  Italy: { region: "Europe", bucket: "EUR", footprint: "Developed", fit: 1 },
  "United Arab Emirates": {
    region: "Middle East & Africa",
    bucket: "Other",
    footprint: "Emerging",
    fit: 0,
  },
  "Saudi Arabia": {
    region: "Middle East & Africa",
    bucket: "Other",
    footprint: "Emerging",
    fit: 0,
  },
  "South Africa": {
    region: "Middle East & Africa",
    bucket: "Other",
    footprint: "Emerging",
    fit: 0,
  },
  Nigeria: { region: "Middle East & Africa", bucket: "Other", footprint: "Emerging", fit: 0 },
  Australia: { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", fit: 1 },
  Japan: { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", fit: 1 },
  Singapore: { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", fit: 1 },
  India: { region: "Asia-Pacific", bucket: "Other", footprint: "Emerging", fit: 0 },
  "Hong Kong": { region: "Asia-Pacific", bucket: "Other", footprint: "Developed", fit: 1 },
};

/** ISO 3166-1 alpha-2 code for each country in COUNTRY_GEO, for compact HQ cells. */
export const COUNTRY_CODE: Readonly<Record<string, string>> = {
  "United States": "US",
  Canada: "CA",
  Mexico: "MX",
  Brazil: "BR",
  "United Kingdom": "GB",
  Germany: "DE",
  France: "FR",
  Netherlands: "NL",
  Switzerland: "CH",
  Sweden: "SE",
  Spain: "ES",
  Italy: "IT",
  "United Arab Emirates": "AE",
  "Saudi Arabia": "SA",
  "South Africa": "ZA",
  Nigeria: "NG",
  Australia: "AU",
  Japan: "JP",
  Singapore: "SG",
  India: "IN",
  "Hong Kong": "HK",
};

export interface Selection {
  countries: Set<string>;
  /** Thesis keys a product pick selected (the rubric maps product groups to theses). */
  firmTypes: Set<string>;
  sectors: Set<string>;
  /** Values that matched no facet — callers reject these. */
  unknown: string[];
}

/**
 * Expand facet picks (group labels or sub-chips, from any of the three
 * facets) into concrete match sets. Picking a group label selects all of
 * its subs; product picks select the theses whose product groups name them.
 */
export function expandSelections(def: RubricDefinition, values: readonly string[]): Selection {
  const sel: Selection = {
    countries: new Set(),
    firmTypes: new Set(),
    sectors: new Set(),
    unknown: [],
  };
  for (const raw of values) {
    const v = raw.trim();
    const region = REGIONS.find((g) => g.label === v);
    const product = PRODUCT_GROUPS.find((g) => g.label === v || g.subs.includes(v));
    const industry = INDUSTRY_GROUPS.find((g) => g.label === v);
    if (region) {
      region.subs.forEach((c) => sel.countries.add(c));
    } else if (v in COUNTRY_GEO) {
      sel.countries.add(v);
    } else if (product) {
      for (const t of def.theses.filter((x) => x.productGroups.includes(product.label))) {
        sel.firmTypes.add(t.key);
      }
    } else if (industry) {
      industry.subs.forEach((s) => sel.sectors.add(s));
    } else if (ALL_SECTORS.includes(v)) {
      sel.sectors.add(v);
    } else {
      sel.unknown.push(raw);
    }
  }
  return sel;
}

export function matchesSelection(
  def: RubricDefinition,
  firm: { hqCountry?: string | null; thesis?: string | null; sector?: string | null },
  sel: Selection,
): boolean {
  if (sel.countries.size > 0 && !sel.countries.has(firm.hqCountry ?? "")) {
    return false;
  }
  if (sel.firmTypes.size > 0 && !sel.firmTypes.has(resolveThesis(def, firm.thesis).key)) {
    return false;
  }
  if (sel.sectors.size > 0 && !sel.sectors.has(firm.sector ?? "")) {
    return false;
  }
  return true;
}
