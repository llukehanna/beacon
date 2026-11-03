/** 700 synthetic advisory firms. Names combine plausible surnames and coined place words; any resemblance to a real firm is coincidental. */
import type { Props } from "../../shared/schema.js";
import { ALL_SECTORS, COUNTRY_GEO } from "../../shared/taxonomy.js";
import {
  COVERAGE_LABELS,
  OWNERSHIP_TYPES,
  REVENUE_BANDS,
  SUCCESSION_RISKS,
  firmIdFor,
} from "../../shared/vocab.js";
import { type Rng, gaussian, pick, rng } from "../enrichment/random.js";

export const UNIVERSE_SIZE = 700;
export const UNIVERSE_SEED = "beacon-universe-v1";

const words = (list: string): readonly string[] => list.trim().split(/\s+/);

/** Plausible English- and continental-sounding family names for partnerships and eponymous firms. */
export const SURNAMES = words(`
  Hale Corwin Marlowe Ashby Brandt Calloway Dunmore Everly Fenwick Garrick Halloran Jessup
  Lorimer Maddox Norwood Quill Thackeray Underhill Vance Whitlock
  Zeller Abernathy Bexley Carrow Dalrymple Eastwick Farnham Hartwell Jarrow 
  Lindqvist Merrow Nygaard Oxley Prescott Seward Tolliver Ulrich Vandermeer Wexler
  Ashgrove Barlow Delaney Ellison Fairbairn Gallagher Iverson Kincaid
  Langford Montrose Newcombe Ogilvie Pritchard Quennell Rowntree Sinclair Tremaine Upton
  Vickery Wetherby Yarrow Aldous Brennick Cranmer Duchamp Eckhart Falkner Grafton Holloway
  Ingleby Kowalski Leclair Moreau Navarro Oberlin Petrov Quintero Rosales Santoro
  Thorsen Urquhart Valdez Winslow Yoshida Zimmer Alder Beaumont Colby Drummond Esker Foyle
  Gunnell Harcourt Ibsen Joyner Kestle Lockwood Merriweather Northcott Orrin Pallister Raines
  Strickland Tennant Unwin Verity Wadsworth Ainsley Birch Dorsey Elmore Fletcher Garland
  Hobart Ives Keane Lyle Nash Osgood Penrose Rook Thorne Vail Whitcombe
`);

/** Coined place and landmark words (hills, woods, rivers, estates) for the place-style names. */
export const PLACES = words(`
  Larkmoor Foxwick Wrenholme Highwick Thornlea Ravenholt Kestrelmoor Harrowfell Ashmere Brindlewick
  Coldholme Dovemoor Eldermoor Fernwick Greywick Heronholt Ironlea Junebrook Kingswick Lanternmere
  Mallowick Nightholm Oakholt Pinewick Quarrowby Redholme Silverlea Tamarisk Uplea Wyvernhall
  Willowick Yewmoor Zephyrlea Alderwick Bramblemoor Cedarholm Driftholm Emberwick Fallowick
  Goldholt Hawkbrook Inglewick Jaspermoor Kinlea Lakeholm Marlbrook Northwick Orchardholt
  Pennyfell Ridgewick Stonewick Thistlemoor Underlea Vantry Whitholm Beaconwick Crestmoor
  Granwick Harbrook Millholme Overwick Parkwick Summerlow Tidemoor Wayfell Cobbledene Silverwick
`);

const PARTNERSHIP_SUFFIXES = ["", "", "Partners", "Advisory", "Advisors"] as const;
const TRIO_SUFFIXES = ["", "", "Partners"] as const;
const SURNAME_SUFFIXES = [
  "Advisory",
  "Advisors",
  "Partners",
  "Capital Partners",
  "& Co.",
  "Group",
  "Corporate Finance",
  "Securities",
] as const;
const PLACE_SUFFIXES = [
  "Capital Partners",
  "Capital",
  "Advisors",
  "Advisory",
  "Partners",
  "Group",
  "Securities",
] as const;
/** `count` different items, drawn in order. */
function distinct(r: Rng, items: readonly string[], count: number): string[] {
  const chosen: string[] = [];
  while (chosen.length < count) {
    const item = pick(r, items);
    if (!chosen.includes(item)) {
      chosen.push(item);
    }
  }
  return chosen;
}

const join = (...parts: readonly string[]) => parts.filter(Boolean).join(" ");

/**
 * Surnames of banks, brokers, advisers and insurers that people would recognise.
 * No generated name may contain one, and neither word list may include one.
 */
export const RESERVED_WORDS = words(`
  Lazard Rothschild Evercore Lokey Jefferies Moelis Perella Greenhill Piper Sandler
  Baird Stifel Cowen Lincoln Duff Phelps Morgan Stanley Goldman Sachs Merrill Lynch Salomon
  Lehman Warburg Schroder Fleming Kleinwort Hambro Peel Panmure Gordon Investec Canaccord
  Berenberg Stephens Janney Oppenheimer Hambrecht Ziegler Harris Raymond James Brown Barclays
  Nomura Macquarie Cavendish Numis Liberum Singer Cenkos Shore Evelyn Brewin Quilter Rathbone
  Hargreaves Hargreave Lansdown Marsh McLennan Aon Willis Lockton Rutledge Gresham Mercer Sutter
`);

/**
 * One invented firm name in one of four house styles: two-surname partnership
 * ("Hale & Corwin"), three-surname partnership ("Hale, Corwin & Ashby"),
 * surname plus noun ("Marlowe Advisory"), or place plus noun
 * ("Wrenholme Capital Partners"). Pure: the same draws always give the same name.
 */
export function firmNameFor(r: Rng): string {
  const style = pick(
    r,
    ["partnership", "trio", "surname", "place"] as const,
    [0.25, 0.2, 0.3, 0.25],
  );
  switch (style) {
    case "partnership": {
      const [first, second] = distinct(r, SURNAMES, 2);
      return join(`${first} & ${second}`, pick(r, PARTNERSHIP_SUFFIXES));
    }
    case "trio": {
      const [first, second, third] = distinct(r, SURNAMES, 3);
      return join(`${first}, ${second} & ${third}`, pick(r, TRIO_SUFFIXES));
    }
    case "surname":
      return join(pick(r, SURNAMES), pick(r, SURNAME_SUFFIXES));
    case "place":
      return join(pick(r, PLACES), pick(r, PLACE_SUFFIXES));
  }
}

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
  // Names draw from a stream of their own so they never shift the country,
  // headcount and coverage draws.
  const nameRng = rng(`${seed}:names`);
  const names = new Set<string>();
  const firms: Props<"Firm">[] = [];
  while (firms.length < size) {
    const name = firmNameFor(nameRng);
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
