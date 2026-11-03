/** 700 synthetic advisory firms. Names come from invented words; any resemblance to a real firm is coincidental. */
import type { Props } from "../../shared/schema.js";
import { ALL_SECTORS, COUNTRY_GEO } from "../../shared/taxonomy.js";
import {
  COVERAGE_LABELS,
  OWNERSHIP_TYPES,
  REVENUE_BANDS,
  SUCCESSION_RISKS,
  firmIdFor,
} from "../../shared/vocab.js";
import { gaussian, pick, rng } from "../enrichment/random.js";

export const UNIVERSE_SIZE = 700;
export const UNIVERSE_SEED = "beacon-universe-v1";

const STEMS = [
  "Brevarre",
  "Calthorn",
  "Dellaway",
  "Elsworthy",
  "Farrowgate",
  "Gannister",
  "Halvercroft",
  "Istrenne",
  "Jorvane",
  "Kellmarsh",
  "Loxbury",
  "Morrendale",
  "Nethercote",
  "Orlanne",
  "Pellingham",
  "Quarrington",
  "Rathmore",
  "Sallowfield",
  "Tarrenvale",
  "Ulverdane",
  "Vessington",
  "Wexcombe",
  "Yardleigh",
  "Zennormoor",
  "Ambercroft",
  "Bellhaven",
  "Corrivale",
  "Dunstanmere",
  "Eversholt",
  "Fallowmere",
  "Glenharrow",
  "Hollinsby",
  "Ivorwick",
  "Kestermoor",
  "Lanworth",
  "Mirrowdale",
  "Northwold",
  "Oakenvale",
  "Pennarth",
  "Ravenmere",
] as const;
const MIDDLES = ["", " Hollis", " Maren", " Voss", " Talbot", " Quay"] as const;
const SUFFIXES = [
  "Partners",
  "Advisors",
  "Capital Advisors",
  "& Co.",
  "Group",
  "Advisory",
  "Corporate Finance",
  "Securities",
] as const;

const COUNTRY_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["United States", 45],
  ["United Kingdom", 12],
  ["Germany", 6],
  ["France", 5],
  ["Canada", 5],
  ["Netherlands", 3],
  ["Switzerland", 3],
  ["Australia", 3],
  ["Sweden", 2],
  ["Spain", 2],
  ["Italy", 2],
  ["Japan", 2],
  ["Singapore", 2],
  ["India", 2],
  ["Hong Kong", 1],
  ["Mexico", 1],
  ["Brazil", 1],
  ["United Arab Emirates", 1],
  ["Saudi Arabia", 1],
  ["South Africa", 1],
  ["Nigeria", 1],
];

export function employeeGroup(n: number): string {
  if (n < 10) {
    return "1-9";
  }
  if (n < 50) {
    return "10-49";
  }
  if (n < 200) {
    return "50-199";
  }
  return "200+";
}

/** Band upper bounds in $M, matching REVENUE_BANDS; the last band is open-ended. */
const BAND_CEILINGS = [10, 25, 50, 100] as const;

/**
 * Profile fields from a generator of their own, seeded per firm, so adding them
 * left every earlier draw (names, countries, headcount, coverage) where it was.
 * Revenue follows headcount at roughly $0.45M a head, with spread.
 */
export function profileFor(
  seed: string,
  firmId: string,
  employees: number,
): Pick<Props<"Firm">, "revenueBand" | "ownership" | "successionRisk"> {
  const r = rng(`${seed}:profile:${firmId}`);
  const revenueM = employees * 0.45 * Math.exp(0.35 * gaussian(r));
  const band = BAND_CEILINGS.findIndex((ceiling) => revenueM < ceiling);
  const revenueBand = REVENUE_BANDS[band === -1 ? REVENUE_BANDS.length - 1 : band];
  // Bigger firms are likelier to have outside capital or a parent.
  const size = Math.min(1, employees / 200);
  const ownership = pick(r, OWNERSHIP_TYPES, [
    0.55 - 0.3 * size,
    0.3 - 0.05 * size,
    0.1 + 0.3 * size,
    0.05,
  ]);
  const successionRisk = pick(
    r,
    SUCCESSION_RISKS,
    ownership === "Founder-owned"
      ? [0.2, 0.4, 0.4]
      : ownership === "Partnership"
        ? [0.4, 0.4, 0.2]
        : [0.7, 0.25, 0.05],
  );
  return { revenueBand, ownership, successionRisk };
}

export function generateUniverse(size = UNIVERSE_SIZE, seed = UNIVERSE_SEED): Props<"Firm">[] {
  const r = rng(seed);
  const names = new Set<string>();
  const firms: Props<"Firm">[] = [];
  while (firms.length < size) {
    const name = `${pick(r, STEMS)}${pick(r, MIDDLES)} ${pick(r, SUFFIXES)}`;
    if (names.has(name)) {
      continue;
    }
    names.add(name);
    const country = pick(
      r,
      COUNTRY_WEIGHTS.map((c) => c[0]),
      COUNTRY_WEIGHTS.map((c) => c[1]),
    );
    const geo = COUNTRY_GEO[country];
    const employees = Math.min(
      600,
      Math.max(2, Math.round(Math.exp(Math.log(25) + 0.9 * gaussian(r)))),
    );
    const firmId = firmIdFor(name, country);
    firms.push({
      firmId,
      firmName: name,
      source: "synthetic",
      firmType: r() < 0.1 ? "CS" : "CF",
      hqCountry: country,
      geography: geo.bucket,
      geographicFootprint: geo.footprint,
      geoScore: geo.geoScore,
      sector: pick(r, ALL_SECTORS),
      employees,
      employeeGroup: employeeGroup(employees),
      ...profileFor(seed, firmId, employees),
      coverageModel: pick(r, COVERAGE_LABELS, [0.15, 0.4, 0.45]),
      lifecycleState: "Discovered",
      currentStage: "Discovered",
    });
  }
  return firms;
}
