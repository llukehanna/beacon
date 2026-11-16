/**
 * Mock source documents. Each (provider, firm) pair renders to a short record in that provider's
 * house style, built from what the provider observes for the firm (coverage gaps and errors
 * included): the CRM's relationship-manager note, Deal DB's league-table row and deal lines, a
 * regulatory filing excerpt, and web search results. Every value sits inside a sentence of its
 * own, worded one of several ways, that a reader has to read to find it. Extraction reads these
 * documents, never the hidden truth. Pure: no DB, network, or crypto.
 */
import { evidenceTraits } from "../../shared/rubric/catalog.js";
import { PROVIDER_TRUST, type Provider } from "../../shared/vocab.js";
import { ADVISORY_ACQUISITIONS as WS } from "../../shared/workspaces/advisoryAcquisitions.js";
import { type FirmRef, PROVIDERS, idOf, observe } from "../enrichment/providers.js";
import { type Rng, hash32, pick, rng } from "../enrichment/random.js";

/** Bump when any template changes: stored extractions made against older text go stale. */
export const DOCUMENT_VERSION = "doc-v2";

export interface DocumentField {
  axis: string;
  value: string;
  sentence: string;
}

export interface SourceDocument {
  documentId: string;
  provider: Provider;
  providerLabel: string;
  firmId: string;
  title: string;
  body: string;
  fields: DocumentField[];
  hash: string;
}

const hex = (n: number): string => n.toString(16).padStart(8, "0");

const plural = (n: string, one: string, many: string): string => (n === "1" ? one : many);
const years = (v: string): string => `${v} ${plural(v, "year", "years")}`;

/** Text ending in exactly one full stop, so "Ives & Co." never gets a second one. */
export const endSentence = (s: string): string => (s.endsWith(".") ? s : `${s}.`);

/** Sentence templates for one axis: each takes the value exactly as `observe` returns it. */
type Templates = readonly ((v: string) => string)[];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const month = (r: Rng, years: readonly number[] = [2025, 2026]): string =>
  `${pick(r, MONTHS)} ${pick(r, years)}`;
/** Months as "Month YYYY", newest first. */
const newestFirst = (dates: readonly string[]): string[] => {
  const at = (d: string): number => {
    const [m, y] = d.split(" ");
    return Number(y) * 12 + MONTHS.indexOf(m as (typeof MONTHS)[number]);
  };
  return [...dates].sort((a, b) => at(b) - at(a));
};

/** Draw `n` different items. */
function some<T>(r: Rng, items: readonly T[], n: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  }
  return out;
}

/** Businesses a corporate-finance boutique sells or buys for clients, kept generic. */
const CF_DEALS = [
  "sale of a founder-owned software business to a strategic buyer",
  "sale of a family-owned food ingredients maker to a private-equity buyer",
  "acquisition of a regional logistics operator for a listed client",
  "sale of a dental services group to a mid-market sponsor",
  "management buyout of a specialty chemicals distributor",
  "sale of a testing and inspection business to a trade buyer",
  "acquisition of an insurance brokerage for a consolidator",
  "sale of an HVAC services company to a private-equity buyer",
  "carve-out of a medical devices division from its parent",
  "sale of a payments processor to a strategic buyer",
  "minority growth investment in a cybersecurity firm",
  "sale of a building products manufacturer to a family office",
] as const;
/** The same for a capital-solutions firm: raising and placing private capital. */
const CS_DEALS = [
  "unitranche refinancing for a sponsor-owned healthcare business",
  "continuation vehicle for a mid-market buyout fund",
  "private placement of senior notes for a family-owned manufacturer",
  "preferred equity raise for a software company",
  "asset-backed facility for a specialty finance lender",
  "secondary sale of limited partnership interests",
  "holdco financing for a sponsor-backed services group",
  "growth debt raise for a logistics platform",
  "recapitalisation of a portfolio company ahead of an exit",
  "first close of a lower-mid-market credit fund",
] as const;
const ROLES = ["Sell-side adviser", "Buy-side adviser", "Financial adviser", "Lead adviser"];
const CS_ROLES = ["Placement agent", "Debt adviser", "Capital adviser", "Arranger"];

const isCs = (f: FirmRef): boolean => (f.thesis ?? "").toLowerCase() === "cs";

interface Style {
  /** Sentence templates per axis this provider reports. */
  sentences: Readonly<Record<string, Templates>>;
  /** The whole document, given the firm, its field sentences in axis order, and the draws. */
  render: (name: string, firm: FirmRef, fields: readonly DocumentField[], r: Rng) => string[];
}

/** Internal CRM: a relationship manager's profile note. */
const CRM: Style = {
  sentences: {
    services_fit: [
      (v) => `Service offering is tagged "${v}" after the last coverage call.`,
      (v) => `We have the offering down as "${v}"; nothing in the last call changed that.`,
      (v) => `On services, the partners' own description fits our "${v}" tag.`,
    ],
    md_pedigree: [
      (v) => `Senior bench reads as "${v}" from the bios the partners sent over.`,
      (v) => `MD backgrounds, from the intro call and public bios: "${v}".`,
      (v) => `We log the managing directors' pedigree as "${v}".`,
    ],
    firm_age: [
      (v) => `The founders set the firm up ${years(v)} ago and still run it day to day.`,
      (v) => `Been in business ${years(v)}, per the partners on our last call.`,
      (v) => `They have operated as an independent firm for ${years(v)}.`,
    ],
    fee_generating_count: [
      (v) =>
        `${v} ${plural(v, "fee-earner", "fee-earners")} on the deal team, by the partners' own count.`,
      (v) =>
        `Headcount note: ${v} ${plural(v, "professional generates", "professionals generate")} fees; the rest is support staff.`,
      (v) => `The partners told us ${v} of their people bill fees on mandates.`,
    ],
  },
  render: (name, firm, fields, r) => {
    const team = isCs(firm)
      ? pick(r, ["Private capital coverage", "Financing solutions coverage"])
      : pick(r, ["Mid-market M&A coverage", "Sponsor coverage", "Founder-owned coverage"]);
    const head = [
      `Relationship profile: ${name}`,
      `${team} · last reviewed ${month(r)}`,
      pick(r, [
        "Notes from the last two calls with the founding partners, kept current by the coverage team.",
        "Summary of what we know from the partner meeting and the follow-up emails.",
        "Built from an intro call and desk notes; the partners were open about the business.",
      ]),
    ];
    if (fields.length === 0) {
      return [head[0], head[1], "No call notes on file yet: no detail beyond the firm's website."];
    }
    return [
      ...head,
      ...fields.map((f) => f.sentence),
      pick(r, [
        "Next step: catch up after their next close.",
        "Next step: invite the partners to the spring sector dinner.",
        "Next step: revisit once their current mandate signs.",
        "Keep warm; no live conversation at the moment.",
      ]),
    ];
  },
};

/** Deal DB: a league-table row, the firm's figures, and its recent deal lines. */
const DEAL_DB: Style = {
  sentences: {
    deal_size_usd_m: [
      (v) => `Median disclosed deal value: $${v} million.`,
      (v) => `Typical disclosed transaction size over the period was about $${v} million.`,
      (v) =>
        `Where terms were disclosed, deals clustered around $${v} million in enterprise value.`,
    ],
    deals_per_md_l3y: [
      (v) => `Closed ${v} deals per managing director a year over 2023–25.`,
      (v) => `Productivity: ${v} completed deals per MD per year across the three years.`,
      (v) => `Averaged ${v} closings per managing director annually in the last three years.`,
    ],
    firm_age: [
      (v) => `First mandate on record ${years(v)} ago.`,
      (v) => `Active in the database for ${years(v)}.`,
      (v) => `Tracked as an independent adviser for the past ${years(v)}.`,
    ],
    fee_generating_count: [
      (v) =>
        `Bankers credited on mandates: ${v} ${plural(v, "fee-earning professional", "fee-earning professionals")}.`,
      (v) => `Deal team on recent announcements: ${v} ${plural(v, "fee-earner", "fee-earners")}.`,
      (v) =>
        `${v} ${plural(v, "professional is", "professionals are")} credited as fee-earners on the firm's deals.`,
    ],
    balance_sheet_principal: [
      (v) => `Principal activity flag: ${v}.`,
      (v) => `Role on deals in the period: ${v}.`,
      (v) => `Balance-sheet use, from deal announcements: ${v}.`,
    ],
  },
  render: (name, firm, fields, r) => {
    const cs = isCs(firm);
    const title = pick(
      r,
      cs
        ? [
            "Deal DB · Private capital advisory league table, 2023–2025",
            "Deal DB · Placement agent rankings by announced raises, 2023–2025",
          ]
        : [
            "Deal DB · M&A advisory league table, mid-market, 2023–2025",
            "Deal DB · Adviser rankings by announced mandates, 2023–2025",
            "Deal DB · Boutique adviser league table, 2023–2025",
          ],
    );
    if (fields.length === 0) {
      return [title, `No league-table entry: no detail on mandates for ${endSentence(name)}`];
    }
    const mandates = 4 + Math.floor(r() * 40);
    const row = `#${12 + Math.floor(r() * 230)} · ${name} · ${mandates} announced mandates · lead adviser on ${40 + Math.floor(r() * 55)}% of them`;
    const deals = some(r, cs ? CS_DEALS : CF_DEALS, 2 + Math.floor(r() * 2));
    const dates = newestFirst(deals.map(() => month(r, [2023, 2024, 2025])));
    const lines = deals.map(
      (deal, i) =>
        `${dates[i]} · ${pick(r, cs ? CS_ROLES : ROLES)} · ${deal} · terms not disclosed`,
    );
    return [title, row, ...fields.map((f) => f.sentence), "Recent deal lines", ...lines];
  },
};

/** The filing's items, in the order the excerpt shows them. */
const FILING_ITEMS: readonly { heading: string; axes: readonly string[] }[] = [
  { heading: "Item 1. Firm history", axes: ["firm_age"] },
  {
    heading: "Item 4. Business activities",
    axes: ["balance_sheet_principal", "has_st_or_balance_sheet"],
  },
  { heading: "Item 7. Conflicts of interest", axes: ["advisory_conflict"] },
  { heading: "Item 9. Financial condition", axes: ["solvent"] },
];

/** Regulatory filings: an excerpt with item headings and numbered answers. */
const FILINGS: Style = {
  sentences: {
    firm_age: [
      (v) => `1.3 Years since first registration: ${v}.`,
      (v) => `1.3 The filer has been registered and operating for ${years(v)}.`,
      (v) => `1.3 Continuous operation as an advisory business: ${years(v)}.`,
    ],
    balance_sheet_principal: [
      (v) => `4.1 Principal investing, as described by the filer: ${v}.`,
      (v) => `4.1 Use of firm capital in client transactions: ${v}.`,
      (v) => `4.1 The filer describes its principal activity as follows: ${v}.`,
    ],
    has_st_or_balance_sheet: [
      (v) => `4.2 Sales-and-trading desk or balance-sheet commitment, as filed: ${v}.`,
      (v) => `4.2 Operates a trading desk or commits its own balance sheet: ${v}.`,
      (v) => `4.2 Response to the trading-desk and balance-sheet question: ${v}.`,
    ],
    advisory_conflict: [
      (v) => `7.2 Conflicting advisory relationship disclosed: ${v}.`,
      (v) => `7.2 Advisory relationship that conflicts with a current mandate: ${v}.`,
      (v) => `7.2 Conflict of interest from an existing advisory relationship, as reported: ${v}.`,
    ],
    solvent: [
      (v) => `9.1 Solvency attestation at the most recent reporting date: ${v}.`,
      (v) => `9.1 The filer meets its capital requirements and is solvent: ${v}.`,
      (v) => `9.1 Solvent at the reporting date, per the filer's attestation: ${v}.`,
    ],
  },
  render: (name, _firm, fields, r) => {
    const head = [
      `Regulatory filing excerpt: ${name}`,
      `Annual registration update, filed ${month(r)}. Items not shown were left blank.`,
    ];
    if (fields.length === 0) {
      return [head[0], `No current registration found: no detail on file for ${endSentence(name)}`];
    }
    const body = FILING_ITEMS.flatMap((item) => {
      const own = fields.filter((f) => item.axes.includes(f.axis));
      const first = item.axes[0] === "firm_age" ? [`1.1 Legal name: ${name}`] : [];
      return own.length === 0 && first.length === 0
        ? []
        : [item.heading, ...first, ...own.map((f) => f.sentence)];
    });
    return [
      ...head,
      ...body,
      pick(r, [
        "Signed by the chief compliance officer.",
        "Amendments filed after this date are not reflected.",
        "The full filing is available from the regulator on request.",
      ]),
    ];
  },
};

/** Web search: result titles with snippets, plus press lines. */
const WEB: Style = {
  sentences: {
    services_fit: [
      (v) => `An industry directory lists the firm's services as "${v}".`,
      (v) => `A trade-press profile sums up the offering as "${v}".`,
      (v) => `The directory files the firm under "${v}" for services.`,
    ],
    md_pedigree: [
      (v) => `Team page bios point to "${v}" at managing-director level.`,
      (v) => `A trade-press piece on the partners describes them as "${v}".`,
      (v) => `Partner profiles on the firm's site read as "${v}".`,
    ],
    web_activity: [
      (v) => `Crawl summary, new or updated public pages in the last 90 days: ${v}.`,
      (v) => `Recent public web activity found in the last quarter: ${v}.`,
      (v) => `Index check for fresh pages, news or posts within 90 days: ${v}.`,
    ],
    deals_per_md_l3y: [
      (v) =>
        `The firm says its managing directors closed ${v} deals each a year over the last three years.`,
      (v) => `Press release: managing directors averaged ${v} closed deals a year since 2023.`,
      (v) =>
        `A league-table write-up credits the firm with ${v} deals per managing director a year over three years.`,
    ],
  },
  render: (name, firm, fields, r) => {
    const head = `Web search: "${name}"`;
    if (fields.length === 0) {
      return [head, `No relevant results: no detail found for ${endSentence(name)}`];
    }
    const titles: Readonly<Record<string, string>> = {
      services_fit: pick(r, ["Industry directory · Advisers", "Trade press · Firm profile"]),
      md_pedigree: pick(r, [`${name} · Our team`, "Trade press · People moves"]),
      web_activity: "Search index · Site activity",
      deals_per_md_l3y: pick(r, [`${name} · News`, "Trade press · League tables"]),
    };
    const results = fields.flatMap((f) => [titles[f.axis], f.sentence]);
    const press = `${month(r)} · Trade press: ${name} advises on the ${pick(r, isCs(firm) ? CS_DEALS : CF_DEALS)}`;
    return [head, `About ${8 + Math.floor(r() * 90)} results`, ...results, press];
  },
};

const STYLES: Readonly<Record<Provider, Style>> = {
  beacondb: CRM,
  dealdb: DEAL_DB,
  filings: FILINGS,
  websearch: WEB,
};

export function sourceDocument(provider: Provider, firm: FirmRef): SourceDocument {
  const firmId = idOf(firm);
  const name = firm.firmName ?? "this firm";
  const label = PROVIDERS[provider].label;
  const style = STYLES[provider];
  const r = rng(`doc|${DOCUMENT_VERSION}|${provider}|${firmId}`);

  const fields: DocumentField[] = [];
  for (const axis of evidenceTraits(WS.traits)) {
    const o = observe(provider, firm, axis);
    if (o) {
      const say = pick(r, style.sentences[axis.traitKey]);
      fields.push({ axis: axis.traitKey, value: o.value, sentence: say(o.value) });
    }
  }

  const body = style.render(name, firm, fields, r).join("\n");
  return {
    documentId: `${provider}:${firmId}`,
    provider,
    providerLabel: label,
    firmId,
    title: `${label}: ${name}`,
    body,
    fields,
    hash: hex(hash32(`${DOCUMENT_VERSION}\n${body}`)),
  };
}

/** All four documents for a firm, most- to least-trusted provider. */
export function firmDocuments(firm: FirmRef): SourceDocument[] {
  return PROVIDER_TRUST.map((p) => sourceDocument(p, firm));
}

/** A stable fingerprint of the template version and every body. */
export function documentsHash(docs: readonly SourceDocument[]): string {
  return hex(hash32([DOCUMENT_VERSION, ...docs.map((d) => d.body)].join("\n\u0000\n")));
}
