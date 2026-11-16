/**
 * The advisory-acquisitions workspace's own vocabulary: the option labels its rubric scores, its
 * profile bands, and the legacy axis map the seed history still writes columns through (Phase B
 * moves the seed onto trait values and deletes it). Nothing outside the workspace, the seed, the
 * mock agent paths and tests may import this.
 */

/** Annual revenue bands for a target firm, smallest first. */
export const REVENUE_BANDS = ["<$10M", "$10–25M", "$25–50M", "$50–100M", ">$100M"] as const;
export type RevenueBand = (typeof REVENUE_BANDS)[number];

export const OWNERSHIP_TYPES = ["Founder-owned", "Partnership", "PE-backed", "Subsidiary"] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** How exposed the firm is to a leadership transition. */
export const SUCCESSION_RISKS = ["Low", "Medium", "High"] as const;
export type SuccessionRisk = (typeof SUCCESSION_RISKS)[number];

/** Rubric v2 option labels, index = points. */
export const CF_SERVICES_LABELS = [
  "Conflicted: trading, lending or research",
  "Adjacent advisory services",
  "Full advisory suite",
] as const;
export const CF_MD_LABELS = [
  "Operator / non-finance backgrounds",
  "Mixed: industry or boutique banking",
  "Bulge-bracket or elite-boutique alumni",
] as const;
export const CS_SERVICES_LABELS = [
  "No private-capital products",
  "Some private-capital products",
  "Full private-capital suite",
] as const;
export const CS_MD_LABELS = [
  "Non-finance backgrounds",
  "Some credit or banking experience",
  "Senior credit / capital-markets pedigree",
] as const;
export const CS_BSP_LABELS = [
  "Invests its own balance sheet",
  "Occasional co-investment",
  "Advisory only",
] as const;
export const COVERAGE_LABELS = ["Generalist", "Multi-sector", "Single-sector focus"] as const;

export type AxisKind = "enum" | "number" | "gate";

export interface AxisDef {
  /** Finding vocabulary (snake_case), as the desk's FINDING_AXIS_TO_KEY expects. */
  axis: string;
  /** Firm property the value lands in. */
  firmField: string;
  /** enrichFirm parameter name (differs from firmField only for hasSTOrBalanceSheet). */
  actionParam: string;
  kind: AxisKind;
  models: readonly ("CF" | "CS")[];
}

const BOTH = ["CF", "CS"] as const;

export const ENRICH_AXES: readonly AxisDef[] = [
  {
    axis: "services_fit",
    firmField: "servicesFit",
    actionParam: "servicesFit",
    kind: "enum",
    models: BOTH,
  },
  {
    axis: "md_pedigree",
    firmField: "mdPedigree",
    actionParam: "mdPedigree",
    kind: "enum",
    models: BOTH,
  },
  {
    axis: "balance_sheet_principal",
    firmField: "balanceSheetPrincipal",
    actionParam: "balanceSheetPrincipal",
    kind: "enum",
    models: ["CS"],
  },
  {
    axis: "deal_size_usd_m",
    firmField: "dealSizeMUsd",
    actionParam: "dealSizeMUsd",
    kind: "number",
    models: BOTH,
  },
  {
    axis: "deals_per_md_l3y",
    firmField: "dealsPerMdL3y",
    actionParam: "dealsPerMdL3y",
    kind: "number",
    models: BOTH,
  },
  { axis: "firm_age", firmField: "firmAge", actionParam: "firmAge", kind: "number", models: BOTH },
  {
    axis: "fee_generating_count",
    firmField: "feeGeneratingCount",
    actionParam: "feeGeneratingCount",
    kind: "number",
    models: BOTH,
  },
  {
    axis: "advisory_conflict",
    firmField: "advisoryConflict",
    actionParam: "advisoryConflict",
    kind: "gate",
    models: BOTH,
  },
  {
    axis: "has_st_or_balance_sheet",
    firmField: "hasSTOrBalanceSheet",
    actionParam: "hasStOrBalanceSheet",
    kind: "gate",
    models: BOTH,
  },
  {
    axis: "web_activity",
    firmField: "webActivity",
    actionParam: "webActivity",
    kind: "gate",
    models: BOTH,
  },
  { axis: "solvent", firmField: "solvent", actionParam: "solvent", kind: "gate", models: BOTH },
];

export function axisByName(axis: string): AxisDef | undefined {
  return ENRICH_AXES.find((a) => a.axis === axis.trim().toLowerCase());
}

export function axisByActionParam(param: string): AxisDef | undefined {
  return ENRICH_AXES.find((a) => a.actionParam === param);
}
