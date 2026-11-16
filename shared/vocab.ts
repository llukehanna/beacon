/** Canonical vocabulary shared by the server, the seed generator, and the UI. */

export const USER = "demo-analyst";

/** The deal funnel, in order. A firm moves forward one stage at a time. */
export const LIFECYCLE_STAGES = [
  "Discovered",
  "Screening",
  "Qualified",
  "Outreach",
  "NDA",
  "IOI",
  "LOI",
  "Closed",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Terminal outcome for a firm we decided not to pursue. */
export const PASSED = "Passed";
export type LifecycleState = LifecycleStage | typeof PASSED;

/** Next forward stage, or null after Closed and for Passed. */
export function nextLifecycle(state: LifecycleState): LifecycleStage | null {
  const idx = (LIFECYCLE_STAGES as readonly string[]).indexOf(state);
  if (idx < 0 || idx >= LIFECYCLE_STAGES.length - 1) {
    return null;
  }
  return LIFECYCLE_STAGES[idx + 1];
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();

const LEGACY_LIFECYCLE: readonly (readonly [string, LifecycleState])[] = [
  ["in review", "Screening"],
  ["in talks", "Outreach"],
  ["rejected", PASSED],
];

const LIFECYCLE_BY_FOLDED: ReadonlyMap<string, LifecycleState> = new Map([
  ...([...LIFECYCLE_STAGES, PASSED] as const).map((s): readonly [string, LifecycleState] => [
    fold(s),
    s,
  ]),
  ...LEGACY_LIFECYCLE,
]);

/**
 * Map any stored lifecycle value onto the current funnel: legacy names are
 * translated, case and separators are ignored, and anything unknown or empty
 * is a firm that has not been looked at yet.
 */
export function normalizeLifecycle(raw: string | null | undefined): LifecycleState {
  return LIFECYCLE_BY_FOLDED.get(fold(raw ?? "")) ?? "Discovered";
}

/** Qualified or later: the firm has been accepted into the funnel's deal stages. */
export function isQualifiedOrLater(state: LifecycleState): boolean {
  return (
    (LIFECYCLE_STAGES as readonly string[]).indexOf(state) >= LIFECYCLE_STAGES.indexOf("Qualified")
  );
}

export type Provider = "beacondb" | "dealdb" | "filings" | "websearch";
/** Most- to least-trusted. Reconciliation orders evidence by this. */
export const PROVIDER_TRUST: readonly Provider[] = ["beacondb", "dealdb", "filings", "websearch"];
/** Human-readable provider labels; keys match server/enrichment/providers.ts. */
export const PROVIDER_LABEL: Record<string, string> = {
  // The mock "BeaconDB" source plays a firm's own CRM record; the provider id stays beacondb.
  beacondb: "Internal CRM (mock)",
  dealdb: "Deal DB",
  filings: "Filings",
  websearch: "Web search",
  analyst: "Analyst",
  agent: "Agent",
  market_signal: "Synthetic market signal",
};

/** Label a provider key, including corroboration keys like "dealdb+websearch". */
export function providerLabel(raw: string): string {
  return raw
    .split("+")
    .map((k) => PROVIDER_LABEL[k] ?? k)
    .join(" + ");
}

export const ANALYST = "analyst";
export const AGENT = "agent";
/** The provider key of a finding written by a synthetic market signal (see shared/marketSignals.ts). */
export const MARKET_SIGNAL = "market_signal";

export const DECISION = {
  enrich: "enrich",
  accept: "accept",
  adjust: "adjust",
  reject: "reject",
  reEngage: "re_engage",
  advance: "advance",
  keepPassed: "keep_passed",
  acknowledgeDrift: "acknowledge_drift",
  activity: "activity",
} as const;

export const ACQUIRED_BY_COMPETITOR = "acquired_by_competitor";
export const OUTCOMES = [
  "converted_to_talks",
  "loi",
  "closed",
  "went_cold",
  ACQUIRED_BY_COMPETITOR,
] as const;

/**
 * Market outcomes after which the firm is no longer there to approach: bought by someone else. A
 * passed firm with one of these cannot be re-engaged; what is left is the lesson.
 */
export const GONE_OUTCOMES: readonly string[] = [ACQUIRED_BY_COMPETITOR];

export function firmIsGone(outcome: string | null | undefined): boolean {
  return GONE_OUTCOMES.includes((outcome ?? "").trim().toLowerCase());
}

export const OPERATORS = ["<", "<=", ">", ">=", "==", "!="] as const;
export type Operator = (typeof OPERATORS)[number];

/** Firm primary key, same recipe as the original pipeline: name_country, lowercased, alphanumerics only. */
export function firmIdFor(name: string, country: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${slug(name)}_${slug(country)}`;
}
