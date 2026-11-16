/** 700 synthetic advisory firms. Names combine plausible surnames, given names and coined place words; any resemblance to a real firm is coincidental. */
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
import { SEED_KEYS } from "./seedKeys.js";

export const UNIVERSE_SIZE = 700;
export const UNIVERSE_SEED = "beacon-universe-v1";

const words = (list: string): readonly string[] => list.trim().split(/\s+/);

/** Family names, grouped by where a firm founded by that family would most likely be. */
export const SURNAMES_BY_REGION = {
  anglo: words(`
    Hale Corwin Marlowe Ashby Calloway Dunmore Everly Garrick Halloran Jessup Lorimer Maddox
    Norwood Quill Thackeray Underhill Vance Whitlock Abernathy Bexley Carrow Dalrymple Eastwick
    Farnham Hartwell Jarrow Merrow Oxley Prescott Seward Tolliver Wexler Ashgrove Barlow Delaney
    Ellison Fairbairn Gallagher Iverson Kincaid Langford Newcombe Ogilvie Pritchard Quennell
    Rowntree Tremaine Upton Vickery Wetherby Aldous Brennick Cranmer Falkner Grafton Holloway
    Ingleby Strickland Tennant Unwin Verity Wadsworth Ainsley Dorsey Elmore Fletcher Garland Hobart
    Ives Keane Lyle Nash Osgood Penrose Rook Vail Whitcombe Colby Esker Foyle Gunnell Harcourt
    Joyner Kestle Lockwood Merriweather Northcott Orrin Pallister Urquhart Winslow Sinclair Montrose
    Kowalski
    Ackland Allerton Annesley Appleby Archdale Arkwright Atherton Aubrey Aylward Bagshaw Bainbridge
    Balfour Bancroft Bardsley Barrington Bascombe Bassett Beckwith Bellamy Benfield Bentham
    Beresford Bickerton Bidwell Billingham Blackwood Blakemore Blanchard Bloxham Bonham Booker
    Boswell Bowden Boyce Bradshaw Brampton Bray Brereton Brightwell Brockway Bromley Broughton
    Buckland Bullard Burleigh Burrows Callander Carew Carmody Cartwright Castell Catesby Chadwick
    Challis Chandler Chetwood Chilcott Clare Clayborne Coburn Coleridge Colville Compton Copeland
    Corbett Cotterell Coverdale Crabtree Cresswell Croft Crowther Culver Dacre Danvers Darby Darrow
    Dawlish Deering Denholm Denby Devereux Dewhurst Digby Dinsdale Dowling Draycott Dryden Dunbar
    Dunsford Durrant Eardley Eccleston Edgerton Elphick Elsworth Emberton Enfield Everard Eversley
    Fairley Fanshawe Farleigh Fenton Ferrers Fielding Finlay Fitzroy Forsyth Fothergill Fowler
    Frampton Frobisher Fulford Gainsford Galbraith Gardiner Garside Gascoigne Gifford Gilchrist
    Gillard Goddard Godwin Goodall Gorringe Gosling Granger Greaves Greenway Gresley Grimshaw Gurney
    Hadley Haldane Halsey Hamblin Hanbury Harland Harrowby Haslam Hatherley Havelock Hawksworth
    Haworth Hayward Hepworth Hesketh Heywood Hillier Hinchcliffe Hodgson Holbrook Holcombe Hollis
    Hopwood Horsfall Hotham Howarth Huxley Ibbotson Ireton Jellicoe Jennings Kemble Kendrick Kenward
    Kerridge Kilbride Kirkby Lambourne Larkin Latimer Lavington Lawley Leadbetter Lethbridge Linfield
    Linley Littleton Lomax Loveday Lowther Ludlow Lyndon Macaulay Mainwaring Mallory Manners Mansell
    Marchant Markham Marsden Mayhew Medlicott Melville Meredith Merrick Metcalfe Middleton Milbourne
    Molyneux Mortimer Mowbray Musgrave Nettleton Northam Nugent Oakley Onslow Ormerod Otway Overton
    Paget Parkin Paxton Pendleton Percival Peverell Pickard Pilkington Platt Plumridge Pollard
    Porteous Pountney Prideaux Pryor Pullen Radcliffe Rawlings Rayner Redfern Redmayne Renshaw Ridley
    Rigby Rivington Rochford Rossiter Royle Rushworth Sackville Salter Saltonstall Sandford
    Saunderson Scarlett Seabrook Selwyn Shackleton Sharland Sheldon Sherborne Shipley Sidwell
    Skelton Slater Somerville Southall Stapleton Stirling Stockdale Stretton Sturgess Sutcliffe
    Swinburne Tarrant Thornbury Thursby Tilbury Tindall Trelawney Trevelyan Truscott Tunstall
    Turville Vaughan Venables Wainwright Walcott Waldegrave Wallis Warburton Wardle Waring Warrender
    Waverley Weatherall Wheatley Whitaker Whitfield Wickham Wilberforce Willoughby Withers Wolcott
    Woodville Wortley Wray Wycliffe Yelverton Ahern Brannigan Callaghan Cassidy Costello Doherty
    Donnelly Fennessy Gilmartin Hanrahan Keating Kennealy Lafferty McAllister McCandless McKinnon
    Mulcahy Nolan Quinlan Rafferty Sheehan Tierney Whelan Cameron Crichton Guthrie Kerr Lockhart
    Moncrieff Munro Ramsay Rutherford Wishart
  `),
  german: words(`
    Brandt Zeller Ulrich Eckhart Zimmer Adler Albrecht Arnholt Baumgart Becker Berthold Bodenstein
    Brauer Eberhardt Ehrlich Engel Falkenberg Fassbender Feldmann Gerlach Gottfried Gruber Haas
    Hartmann Heller Hoffmeister Holzer Kessler Kirchner Lange Lehner Lindemann Lorenz Maurer
    Meinhardt Messner Neumann Oberhauser Pfeiffer Reinholt Richter Sauer Schaller Schenk Seidel
    Sommer Stahl Steiner Vogel Walther Wendt Winkler Wolff Zander Amstutz Baumann Brunner Egli Frick
    Keller Moser Schnyder Studer Zbinden
  `),
  dutch: words(`
    Vandermeer Bakker Hendriks Jansen Jongman Kuipers Maas Postma Terpstra Verhoeven Visser Wouters
    Brouwer Dijkstra Dekker Hoekstra Kok Meijer Prins Schouten Vos Willems Veenstra Groen Sluiter
    Brink Wesselink
  `),
  nordic: words(`
    Lindqvist Nygaard Thorsen Ahlgren Berglund Dahl Ekholm Engstrand Forsberg Hedlund Holmqvist
    Lindahl Lundgren Nordin Sandberg Stenberg Wallin Lindblom Sjogren Norberg Hallberg Wikstrom
  `),
  french: words(`
    Moreau Leclair Aubert Barbier Beaulieu Bertrand Blanchet Bonnard Brissac Carpentier Chastain
    Courtois Delorme Duval Fabre Girard Guerin Lacombe Laforge Lemaire Marchal Mercier Montclair
    Perrin Rochefort Roussel Thibault Vasseur Vernier
  `),
  spanish: words(`
    Navarro Quintero Rosales Valdez Alvarado Arriaga Bermudez Cabrera Castellano Cordero Echeverria
    Figueroa Ibarra Lozano Medina Montero Olivares Paredes Quiroga Robledo Salcedo Serrano Solano
    Toledo Urrutia Zamora
  `),
  italian: words(`
    Santoro Albani Bellini Bertolini Caruso Colombo Conti Fabbri Ferrante Galli Lombardi Marchetti
    Moretti Orsini Pellegrini Rinaldi Rossetti Sartori Valentini Zanetti
  `),
  portuguese: words(`
    Almeida Barros Cardoso Carvalho Ferraz Machado Moraes Nogueira Pacheco Peixoto Queiroz Ribeiro
    Siqueira Teixeira Vasconcelos
  `),
  japanese: words(`
    Yoshida Arai Fujimoto Hasegawa Ishikawa Kaneko Kimura Kobayashi Matsuda Morikawa Nakagawa Ogawa
    Sakamoto Tanabe Uchida Watanabe Yamaguchi Hirano Shimizu
  `),
  indian: words(`
    Agarwal Bhandari Chaudhary Desai Ghosh Iyer Joshi Kapoor Khanna Mehta Menon Nair Pillai Rao Reddy
    Saxena Sethi Trivedi Varma
  `),
  chinese: words(`
    Chan Cheung Fong Kwan Lau Leung Lim Ong Tan Teo Wong Yeo Chua Koh Goh Ho Tsang Yip Chow Lam Mak
    Kuan Quek Sim Tay Toh Wee
  `),
  nigerian: words(`
    Adeyemi Okafor Balogun Okonkwo Nwosu Adebayo Ogunleye Afolabi Eze Obi Adewale Okeke Ibekwe
  `),
  southafrican: words(`
    Botha Pienaar Venter Joubert Steyn Coetzee Naude Malan Visagie Mokoena Dlamini Nkosi Ndlovu
  `),
} as const;

type Region = keyof typeof SURNAMES_BY_REGION;

/** Every family name the generator can use. */
export const SURNAMES: readonly string[] = Object.values(SURNAMES_BY_REGION).flat();

/** Given names for founder-style names ("Arthur Penrose & Co."). */
export const GIVEN_NAMES = words(`
  Arthur Edwin Alistair Barnaby Basil Benedict Bertram Cecil Clement Cyril Desmond Dorian Edmund
  Felix Fergus Gideon Gilbert Godfrey Hector Horace Hugo Ignatius Jasper Julian Lionel Lucian Magnus
  Malcolm Miles Montague Nigel Oswald Percy Peregrine Quentin Ralph Reginald Silas Simeon Thaddeus
  Theodore Tobias Wilfred Alice Beatrice Clara Cordelia Dorothea Eleanor Edith Florence Harriet
  Imogen Isadora Josephine Lavinia Lydia Margot Matilda Nell Ophelia Philippa Rosalind Sylvia
  Theodora Ursula Vivian Winifred Agnes Adelaide Augusta Celia Delphine Esme Frances Georgina Hester
  Iris Juliet Louisa Maud Mabel Olive Pearl Rosamund Sophia Viola Anselm Crispin Emery Ivo Leopold
  Linus Rufus Sebastian Laurence Roland Conrad Ewan Gregor Alaric
`);

/** Coined place and landmark words (moors, holts, combes, meres) for the place-style names. */
export const PLACES = words(`
  Larkmoor Foxwick Wrenholme Highwick Thornlea Ravenholt Kestrelmoor Harrowfell Brindlewick
  Coldholme Dovemoor Eldermoor Fernwick Greywick Heronholt Ironlea Junebrook Kingswick Lanternmere
  Mallowick Nightholm Oakholt Pinewick Quarrowby Redholme Silverlea Tamarisk Uplea Wyvernhall
  Willowick Yewmoor Zephyrlea Alderwick Bramblemoor Cedarholm Driftholm Emberwick Fallowick Goldholt
  Hawkbrook Inglewick Jaspermoor Kinlea Lakeholm Marlbrook Orchardholt Pennyfell Ridgewick Stonewick
  Thistlemoor Underlea Vantry Crestmoor Granwick Harbrook Millholme Overwick Parkwick Summerlow
  Tidemoor Wayfell Cobbledene Amberlow Badgerholt Barleythorpe Beechcombe Birchshaw Brackenfell
  Briarholme Burrowdene Chalkcombe Cinderholt Clovermere Copperthorpe Cornshaw Cranemoor Curlewdene
  Dunholt Eaglesmere Falconmere Finchcombe Flintholme Gorsemoor Harethorpe Hollinshaw Hollythorpe
  Ivyholme Juniperlea Kitemoor Lapwingdene Larchholt Lindenmere Martenlea Meadowholt Merlinshaw
  Mossdene Myrtlecombe Nettlecombe Ospreyholme Otterdene Owlthorpe Pebblecombe Ploverlea Poppyholt
  Quailmoor Quarryholme Reedmoor Robinshaw Rowanlea Sablemoor Saffronholt Sagecombe Saltholme
  Sandholt Shinglecombe Sloemoor Snipedene Sorrelholt Sparrowlea Starlingholt Swallowmere
  Swanthorpe Tealmoor Ternholme Thrushcombe Tinholt Valemoor Wheatcombe Wildholme Wolfshaw Wychlea
  Anvilmoor Arrowlea Bellcombe Bowholt Cairnshaw Candlemere Cherryholt Cloudmere Coalthorpe Dewholme
  Drakemoor Duskholt Featherlea Fenholme Ferrycombe Flaxmoor Frostholme Galeshaw Gladeholt
  Glenthorpe Harvestlea Haythorpe Hearthmoor Hornshaw Kilnmoor Knotholme Ledgecombe Lilymere
  Loomholt Meadshaw Mistholme Oatlea Pikemoor Plumholt Rainholme Rimeshaw Ryemoor Scarthorpe
  Sealmoor Shalecombe Sheafholt Slatemoor Snowcombe Sparlea Spindlemoor Springholt Starholme
  Stillmere Stormholt Strawlea Swiftholme Tallowmere Thatchcombe Timberholt Tollmoor Torchlea
  Vanecombe Vetchholme Weirholt Whinmoor Windholme Wintercombe Woolthorpe
`);

/** Where a firm's founders most likely came from, by its home country. Anglo where not listed. */
const COUNTRY_REGION: Readonly<Record<string, Region>> = {
  Germany: "german",
  Switzerland: "german",
  Netherlands: "dutch",
  Sweden: "nordic",
  France: "french",
  Spain: "spanish",
  Mexico: "spanish",
  Italy: "italian",
  Brazil: "portuguese",
  Japan: "japanese",
  India: "indian",
  Singapore: "chinese",
  "Hong Kong": "chinese",
  Nigeria: "nigerian",
  "South Africa": "southafrican",
};

/** The house styles a name is built in, with how often each is used. */
export const NAME_STYLES = ["partnership", "trio", "surname", "founder", "place"] as const;
export type NameStyle = (typeof NAME_STYLES)[number];
const STYLE_WEIGHTS: Readonly<Record<"anglo" | "other", readonly number[]>> = {
  anglo: [0.22, 0.08, 0.25, 0.18, 0.27],
  other: [0.3, 0.07, 0.4, 0, 0.23],
};

/** The words after the stems, per style. Empty means none. */
export const NAME_SUFFIXES: Readonly<Record<NameStyle, readonly string[]>> = {
  partnership: ["", "", "Partners", "Advisory", "Advisors", "Capital"],
  trio: ["", "", "Partners"],
  surname: [
    "Advisory",
    "Advisors",
    "Partners",
    "Capital Partners",
    "& Co.",
    "Group",
    "Corporate Finance",
    "Securities",
    "& Partners",
    "Capital Advisors",
    "Associates",
    "Merchant Partners",
    "Advisory Partners",
    "Capital",
  ],
  founder: ["& Co.", "& Co.", "& Company", "Partners"],
  place: [
    "Capital Partners",
    "Capital",
    "Advisors",
    "Advisory",
    "Partners",
    "Group",
    "Securities",
    "Corporate Finance",
    "Capital Advisors",
    "Merchant Partners",
    "Advisory Partners",
  ],
};

/** A legal form some firms carry in their registered name, by country. */
export const LEGAL_FORMS: Readonly<Record<string, string>> = {
  "United States": "LLC",
  "United Kingdom": "LLP",
  Germany: "GmbH",
  Switzerland: "AG",
  Netherlands: "B.V.",
  Sweden: "AB",
  France: "SAS",
  Spain: "S.L.",
  Italy: "S.r.l.",
  Japan: "K.K.",
  Singapore: "Pte. Ltd.",
  India: "Pvt. Ltd.",
  "Hong Kong": "Limited",
  Australia: "Pty Ltd",
  Brazil: "Ltda.",
  Mexico: "S.C.",
};

/** How often a firm's name carries its legal form: rarely at home in the US and UK, more elsewhere. */
const legalFormRate = (country: string): number =>
  country === "United States" || country === "United Kingdom" ? 0.06 : 0.22;

/** A stem may appear in at most this many names, and lead at most one. */
export const MAX_STEM_USES = 2;

const join = (...parts: readonly string[]) => parts.filter(Boolean).join(" ");

/**
 * Surnames of banks, brokers, advisers and insurers that people would recognise.
 * No generated name may contain one, and no word list may include one.
 */
export const RESERVED_WORDS = words(`
  Lazard Rothschild Evercore Lokey Jefferies Moelis Perella Greenhill Piper Sandler
  Baird Stifel Cowen Lincoln Duff Phelps Morgan Stanley Goldman Sachs Merrill Lynch Salomon
  Lehman Warburg Schroder Fleming Kleinwort Hambro Peel Panmure Gordon Investec Canaccord
  Berenberg Stephens Janney Oppenheimer Hambrecht Ziegler Harris Raymond James Brown Barclays
  Nomura Macquarie Cavendish Numis Liberum Singer Cenkos Shore Evelyn Brewin Quilter Rathbone
  Hargreaves Hargreave Lansdown Marsh McLennan Aon Willis Lockton Rutledge Gresham Mercer Sutter
  Centerview Guggenheim Qatalyst Ducera Solomon Gleacher Wasserstein Weinberg Blair
  Davidson Wedbush Mesirow Kroll Alvarez Marsal Seabury Cazenove Arbuthnot Coutts Hoare Metzler
  Vontobel Pictet Sarasin Mediobanca Mizuho Daiwa Kotak Avendus Edelweiss Livingstone Clearwater
  Hawkpoint Altium Ondra Robey Warshaw Fenchurch Townsend Templeton Pemberton Westbrook Hampden
  Stanhope Davenport Conway Jardine Matheson Lindsay Crestview Brookfield Riverstone Ironwood
`);

/** The stems in a name: the words that came from the word lists, in order. */
export const stemsOf = (name: string, stems: ReadonlySet<string>): string[] =>
  name.split(/[^A-Za-z]+/).filter((w) => stems.has(w));

/**
 * A generator of invented firm names, one per call, in one of five house styles: two-surname
 * partnership ("Hale & Corwin"), three-surname partnership ("Hale, Corwin & Ashby"), surname plus
 * noun ("Marlowe Advisory"), founder ("Arthur Penrose & Co.") or place plus noun ("Wrenholme
 * Capital Partners"). Surnames lean to the firm's home region, and some names carry the local legal
 * form ("Kessler & Brandt GmbH"). No stem (surname, given name or place word) appears in more than
 * two names, and none leads two, so no two names share a first word or differ only by suffix.
 * Pure: the same draws in the same order always give the same names.
 */
export function firmNamer(r: Rng): (country: string) => string {
  const uses = new Map<string, number>();
  const leads = new Set<string>();
  const free = (stems: readonly string[]): boolean =>
    !leads.has(stems[0]) &&
    new Set(stems).size === stems.length &&
    stems.every((s) => (uses.get(s) ?? 0) < MAX_STEM_USES);

  return (country) => {
    const region = COUNTRY_REGION[country] ?? "anglo";
    const surname = (): string =>
      r() < 0.75
        ? pick(r, SURNAMES_BY_REGION[region])
        : pick(r, region === "anglo" ? SURNAMES : SURNAMES_BY_REGION.anglo);
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const style = pick(r, NAME_STYLES, STYLE_WEIGHTS[region === "anglo" ? "anglo" : "other"]);
      const stems =
        style === "partnership"
          ? [surname(), surname()]
          : style === "trio"
            ? [surname(), surname(), surname()]
            : style === "surname"
              ? [surname()]
              : style === "founder"
                ? [pick(r, GIVEN_NAMES), surname()]
                : [pick(r, PLACES)];
      const suffix = pick(r, NAME_SUFFIXES[style]);
      const legal =
        r() < legalFormRate(country) && !suffix.includes("&") ? (LEGAL_FORMS[country] ?? "") : "";
      if (!free(stems)) {
        continue;
      }
      leads.add(stems[0]);
      for (const s of stems) {
        uses.set(s, (uses.get(s) ?? 0) + 1);
      }
      const base =
        style === "partnership"
          ? `${stems[0]} & ${stems[1]}`
          : style === "trio"
            ? `${stems[0]}, ${stems[1]} & ${stems[2]}`
            : stems.join(" ");
      return join(base, suffix, legal);
    }
    throw new Error("firmNamer: ran out of unused stems");
  };
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
 * Profile fields from a generator of their own, seeded per firm (by its seed key), so adding
 * them left every earlier draw (names, countries, headcount, coverage) where it was.
 * Revenue follows headcount at roughly $0.45M a head, with spread.
 */
export function profileFor(
  seed: string,
  key: string,
  employees: number,
): Pick<Props<"Firm">, "revenueBand" | "ownership" | "successionRisk"> {
  const r = rng(`${seed}:profile:${key}`);
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
  // Names draw from a stream of their own so they never shift the country, headcount and coverage
  // draws. The namer never repeats a name.
  const nameFor = firmNamer(rng(`${seed}:names:v2`));
  const firms: Props<"Firm">[] = [];
  while (firms.length < size) {
    const country = pick(
      r,
      COUNTRY_WEIGHTS.map((c) => c[0]),
      COUNTRY_WEIGHTS.map((c) => c[1]),
    );
    const name = nameFor(country);
    const geo = COUNTRY_GEO[country];
    const employees = Math.min(
      600,
      Math.max(2, Math.round(Math.exp(Math.log(25) + 0.9 * gaussian(r)))),
    );
    const firmId = firmIdFor(name, country);
    // The profile is drawn from the firm's seed key, so renaming a firm leaves it where it was.
    const key = seed === UNIVERSE_SEED ? (SEED_KEYS[firms.length] ?? firmId) : firmId;
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
      ...profileFor(seed, key, employees),
      coverageModel: pick(r, COVERAGE_LABELS, [0.15, 0.4, 0.45]),
      lifecycleState: "Discovered",
      currentStage: "Discovered",
    });
  }
  return firms;
}

let seedKeys: ReadonlyMap<string, string> | undefined;

/**
 * The key a firm's hidden values are drawn from: for a generated firm, the key it has kept since
 * before the firms were renamed (see seedKeys.ts); for any other firm, its own id.
 */
export function seedKeyFor(firmId: string): string {
  seedKeys ??= new Map(generateUniverse().map((f, i) => [f.firmId!, SEED_KEYS[i]]));
  return seedKeys.get(firmId) ?? firmId;
}
