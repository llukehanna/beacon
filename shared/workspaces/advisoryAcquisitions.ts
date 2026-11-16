/**
 * The advisory-acquisitions workspace: a corporate development team sourcing
 * M&A advisory firms to acquire. Everything team-specific about traits and
 * scoring lives here; the engine and the screens read it as data.
 */
import type { Band, Criterion, ThesisDef, TraitDef } from "../rubric/types.js";
import {
  CF_MD_LABELS,
  CF_SERVICES_LABELS,
  COVERAGE_LABELS,
  CS_BSP_LABELS,
  CS_MD_LABELS,
  CS_SERVICES_LABELS,
  OWNERSHIP_TYPES,
  REVENUE_BANDS,
  SUCCESSION_RISKS,
} from "../vocab.js";
import type { WorkspaceDefinition } from "./types.js";

export const RUBRIC_ID = "advisory-acquisitions@1";

const trait = (
  t: Pick<TraitDef, "traitKey" | "label" | "description" | "kind" | "role"> & Partial<TraitDef>,
): TraitDef => ({ unit: null, options: null, passWhen: null, theses: null, ...t });

const TRAITS: TraitDef[] = [
  trait({
    traitKey: "services_fit",
    label: "Services fit",
    description: "Service offering",
    kind: "category",
    role: "evidence",
    options: [...CF_SERVICES_LABELS, ...CS_SERVICES_LABELS],
  }),
  trait({
    traitKey: "md_pedigree",
    label: "MD pedigree",
    description: "Managing directors' backgrounds",
    kind: "category",
    role: "evidence",
    options: [...CF_MD_LABELS, ...CS_MD_LABELS],
  }),
  trait({
    traitKey: "balance_sheet_principal",
    label: "Balance sheet / principal",
    description: "Principal / balance-sheet activity",
    kind: "category",
    role: "evidence",
    options: [...CS_BSP_LABELS],
    theses: ["CS"],
  }),
  trait({
    traitKey: "deal_size_usd_m",
    label: "Avg deal size",
    description: "Typical deal size, in US$ millions",
    unit: "$m USD",
    kind: "number",
    role: "evidence",
  }),
  trait({
    traitKey: "deals_per_md_l3y",
    label: "Deals per MD (last 3 years)",
    description: "Closed deals per managing director per year, last three years",
    unit: "per MD, last 3 years",
    kind: "number",
    role: "evidence",
  }),
  trait({
    traitKey: "firm_age",
    label: "Firm age",
    description: "Firm age, in years",
    unit: "yrs",
    kind: "number",
    role: "evidence",
  }),
  trait({
    traitKey: "fee_generating_count",
    label: "Fee-earning heads",
    description: "Number of fee-generating professionals",
    unit: "MDs",
    kind: "number",
    role: "evidence",
  }),
  trait({
    traitKey: "advisory_conflict",
    label: "Advisory conflict",
    description: "Has a conflicting advisory relationship",
    kind: "yesno",
    role: "evidence",
    passWhen: false,
  }),
  trait({
    traitKey: "has_st_or_balance_sheet",
    label: "Sales & trading / balance sheet",
    description: "Runs a sales-and-trading desk or a balance sheet",
    kind: "yesno",
    role: "evidence",
    passWhen: false,
  }),
  trait({
    traitKey: "web_activity",
    label: "Web activity",
    description: "Shows recent public web activity",
    kind: "yesno",
    role: "evidence",
    passWhen: true,
  }),
  trait({
    traitKey: "solvent",
    label: "Solvent",
    description: "Is solvent",
    kind: "yesno",
    role: "evidence",
    passWhen: true,
  }),
  trait({
    traitKey: "coverage_model",
    label: "Sector coverage",
    description: "How many sectors the firm covers",
    kind: "category",
    role: "fact",
    options: [...COVERAGE_LABELS],
  }),
  trait({
    traitKey: "geo_score",
    label: "Geographic fit",
    description: "Fit of the firm's headquarters geography, 0 to 2",
    kind: "number",
    role: "fact",
  }),
  trait({
    traitKey: "employees",
    label: "Headcount",
    description: "Total employees",
    unit: "people",
    kind: "number",
    role: "fact",
  }),
  trait({
    traitKey: "revenue_band",
    label: "Revenue band",
    description: "Annual revenue band",
    kind: "category",
    role: "profile",
    options: [...REVENUE_BANDS],
  }),
  trait({
    traitKey: "ownership",
    label: "Ownership",
    description: "Who owns the firm",
    kind: "category",
    role: "profile",
    options: [...OWNERSHIP_TYPES],
  }),
  trait({
    traitKey: "succession_risk",
    label: "Succession risk",
    description: "How exposed the firm is to a leadership transition",
    kind: "category",
    role: "profile",
    options: [...SUCCESSION_RISKS],
  }),
];

const ladder = (labels: readonly string[]) => labels.map((value, points) => ({ value, points }));
const category = (traitKey: string, label: string, labels: readonly string[]): Criterion => ({
  traitKey,
  label,
  weight: 1,
  scoring: { type: "category", options: ladder(labels) },
});
/** Below `lo` → 0, `lo`..`hi` inclusive → 1, above `hi` → 2: rubric v2's three-band shape. */
const threeBands = (lo: number, hi: number, labels: [string, string, string]): Band[] => [
  { max: lo, minInclusive: true, maxInclusive: false, points: 0, label: labels[0] },
  { min: lo, max: hi, minInclusive: true, maxInclusive: true, points: 1, label: labels[1] },
  { min: hi, minInclusive: false, maxInclusive: true, points: 2, label: labels[2] },
];
const bands = (traitKey: string, label: string, b: Band[]): Criterion => ({
  traitKey,
  label,
  weight: 1,
  scoring: { type: "bands", bands: b },
});

/** The six criteria both theses share, in rubric v2's order. */
const SHARED: Criterion[] = [
  {
    traitKey: "geo_score",
    label: "Geographic Footprint",
    weight: 1,
    scoring: { type: "direct", min: 0, max: 2 },
  },
  bands("deal_size_usd_m", "Deal Size", threeBands(25, 150, ["<$25m", "$25m-$150m", ">$150m"])),
  bands("deals_per_md_l3y", "Deals per MD", threeBands(1.5, 3.5, ["<1.5", "1.5-3.5", ">3.5"])),
  bands("firm_age", "Firm Age", threeBands(5, 12, ["<5", "5-12", ">12"])),
  bands("employees", "Headcount", [
    { max: 8, minInclusive: true, maxInclusive: false, points: 0, label: "<8" },
    { min: 8, max: 40, minInclusive: true, maxInclusive: true, points: 2, label: "8-40" },
    { min: 40, minInclusive: false, maxInclusive: true, points: 1, label: ">40" },
  ]),
  bands("fee_generating_count", "Fee-Generating", [
    { max: 2, minInclusive: true, maxInclusive: false, points: 0, label: "<2" },
    { min: 2, max: 3, minInclusive: true, maxInclusive: true, points: 1, label: "2-3" },
    { min: 3, minInclusive: false, maxInclusive: true, points: 2, label: ">=4" },
  ]),
];

const ACTIONS: ThesisDef["actions"] = {
  A: "Outreach",
  B: "Follow",
  C: "Follow",
  Rejected: "Enrich",
  upgrades: [{ tier: "B", minPoints: 12, action: "Outreach" }],
};

export const ADVISORY_ACQUISITIONS: WorkspaceDefinition = {
  key: "advisory-acquisitions",
  name: "Advisory acquisitions",
  traits: TRAITS,
  rubric: {
    defaultThesis: "CF",
    theses: [
      {
        key: "CF",
        label: "Corporate finance",
        productGroups: ["Corporate Finance"],
        criteria: [
          category("coverage_model", "Coverage Model", COVERAGE_LABELS),
          category("services_fit", "Services", CF_SERVICES_LABELS),
          category("md_pedigree", "MD Experience", CF_MD_LABELS),
          ...SHARED,
        ],
        hardRejects: [
          {
            traitKey: "coverage_model",
            operator: "==",
            value: "Generalist",
            reason: "Generalist coverage model (CF hard-reject)",
          },
          {
            traitKey: "services_fit",
            operator: "==",
            value: "Conflicted: trading, lending or research",
            reason: "Conflicted services (CF hard-reject)",
          },
        ],
        tiers: { A: 14, B: 10, C: 6 },
        actions: ACTIONS,
      },
      {
        key: "CS",
        label: "Capital solutions",
        productGroups: ["Capital Solutions"],
        criteria: [
          category("balance_sheet_principal", "Balance Sheet / Principal", CS_BSP_LABELS),
          category("services_fit", "CS Services Fit", CS_SERVICES_LABELS),
          category("md_pedigree", "MD Experience", CS_MD_LABELS),
          ...SHARED,
        ],
        hardRejects: [
          {
            traitKey: "advisory_conflict",
            operator: "==",
            value: "true",
            reason: "Advisory conflict (CS hard-reject)",
          },
          {
            traitKey: "balance_sheet_principal",
            operator: "==",
            value: "Invests its own balance sheet",
            reason: "Principal investor (CS hard-reject)",
          },
        ],
        tiers: { A: 13, B: 10, C: 6 },
        actions: ACTIONS,
      },
    ],
    candidateScreens: [
      {
        axis: "employees",
        operator: "<",
        threshold: "10",
        keywords: "\\b(small|headcount|staff|employees|people)\\b",
        summary:
          "Analysts keep passing on firms too small to absorb an integration (fewer than 10 staff).",
      },
      {
        axis: "deal_size_usd_m",
        operator: "<",
        threshold: "30",
        keywords: "deal size|small deals|below our floor",
        summary: "Typical deal sizes under $30m are consistently rejected as below the floor.",
      },
      {
        axis: "deals_per_md_l3y",
        operator: "<",
        threshold: "2",
        keywords: "deal volume|too few deals|deals per md|productivity",
        summary: "Fewer than two deals per MD over three years reads as a weak franchise.",
      },
      {
        axis: "firm_age",
        operator: "<",
        threshold: "3",
        keywords: "too new|young|track record|founded",
        summary: "Firms under three years old lack the track record the thesis needs.",
      },
      {
        axis: "geo_score",
        operator: "<",
        threshold: "1",
        keywords: "geograph|footprint|region|market access",
        summary: "Firms outside core geographies are passed on for footprint.",
      },
      {
        axis: "coverage_model",
        operator: "==",
        threshold: "Generalist",
        keywords: "generalist|unfocused|no sector depth",
        summary: "Generalist coverage models are rejected for lacking sector depth.",
      },
    ],
  },
  legacyFields: {
    servicesFit: "services_fit",
    mdPedigree: "md_pedigree",
    balanceSheetPrincipal: "balance_sheet_principal",
    dealSizeMUsd: "deal_size_usd_m",
    dealsPerMdL3y: "deals_per_md_l3y",
    firmAge: "firm_age",
    feeGeneratingCount: "fee_generating_count",
    advisoryConflict: "advisory_conflict",
    hasSTOrBalanceSheet: "has_st_or_balance_sheet",
    webActivity: "web_activity",
    solvent: "solvent",
    coverageModel: "coverage_model",
    geoScore: "geo_score",
    employees: "employees",
    revenueBand: "revenue_band",
    ownership: "ownership",
    successionRisk: "succession_risk",
  },
  legacyFieldAliases: {
    servicesFit: "services_fit",
    mdPedigree: "md_pedigree",
    balanceSheetPrincipal: "balance_sheet_principal",
    dealSizeMUsd: "deal_size_usd_m",
    dealsPerMdL3y: "deals_per_md_l3y",
    firmAge: "firm_age",
    feeGeneratingCount: "fee_generating_count",
    advisoryConflict: "advisory_conflict",
    hasSTOrBalanceSheet: "has_st_or_balance_sheet",
    hasStOrBalanceSheet: "has_st_or_balance_sheet",
    webActivity: "web_activity",
    solvent: "solvent",
    coverageModel: "coverage_model",
    geoScore: "geo_score",
    employees: "employees",
    revenueBand: "revenue_band",
    ownership: "ownership",
    successionRisk: "succession_risk",
  },
};
