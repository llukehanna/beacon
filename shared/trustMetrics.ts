/**
 * Trust metrics — agreement / override / honest abstention.
 *
 * Extracted from Accuracy.tsx so the Home trust panel quotes the same
 * numbers the /accuracy page it links to will show. A finding is:
 *   • abstain  — confidenceTier === "abstain" OR findingStatus === "abstained"
 *   • agree    — non-abstain AND (verifiedByHuman === true OR an analyst-
 *                authored finding whose findingStatus is "verified": the
 *                analyst entered the value themselves, so it is settled)
 *   • override — non-abstain AND findingStatus === "rejected"
 *   • pending  — non-abstain, undecided (excluded from agreement/override)
 *
 * Rates:
 *   agreement %  = agree / (agree + override)   (denominator = decided
 *                                                 non-abstain)
 *   override  %  = override / (agree + override)
 *   abstention%  = abstain / all-findings        (denominator = everything
 *                                                 in the group)
 */
import {
  ACQUIRED_BY_COMPETITOR,
  AGENT,
  ANALYST,
  MARKET_SIGNAL,
  PASSED,
  normalizeLifecycle,
  providerLabel,
} from "./vocab.js";

export interface RatedFinding {
  findingId: string;
  axis?: string;
  confidenceTier?: string;
  findingStatus?: string;
  provider?: string;
  verifiedByHuman?: boolean;
}

export interface Rates {
  agreement: number | null; // null when undecided
  override: number | null;
  abstention: number; // always defined
  total: number; // all findings in the group
  decided: number; // agree + override
}

/**
 * A finding written by a synthetic market signal. It records news, not a reading of a source, so
 * it is left out of every trust figure: it was never right or wrong about a value.
 */
export const isMarketSignalFinding = (f: Pick<RatedFinding, "provider">): boolean =>
  (f.provider ?? "").trim().toLowerCase() === MARKET_SIGNAL;

export function classify(f: RatedFinding): "abstain" | "agree" | "override" | "pending" {
  const ct = (f.confidenceTier ?? "").toLowerCase();
  const fs = (f.findingStatus ?? "").toLowerCase();
  if (ct === "abstain" || fs === "abstained") {
    return "abstain";
  }
  if (
    f.verifiedByHuman === true ||
    ((f.provider ?? "").trim().toLowerCase() === ANALYST && fs === "verified")
  ) {
    return "agree";
  }
  if (fs === "rejected") {
    return "override";
  }
  return "pending";
}

/** Findings tallied by `classify`; what the server's SQL aggregates produce and `rates` consumes. */
export interface RateCounts {
  agree: number;
  override: number;
  abstain: number;
  /** Every finding in the group, including pending ones. */
  total: number;
}

export function ratesFromCounts({ agree, override, abstain, total }: RateCounts): Rates {
  const decided = agree + override;
  return {
    agreement: decided > 0 ? Math.round((agree / decided) * 100) : null,
    override: decided > 0 ? Math.round((override / decided) * 100) : null,
    abstention: total > 0 ? Math.round((abstain / total) * 100) : 0,
    decided,
    total,
  };
}

export function countFindings(all: readonly RatedFinding[]): RateCounts {
  const findings = all.filter((f) => !isMarketSignalFinding(f));
  const c: RateCounts = { agree: 0, override: 0, abstain: 0, total: findings.length };
  for (const f of findings) {
    const cls = classify(f);
    if (cls !== "pending") {
      c[cls]++;
    }
  }
  return c;
}

export function rates(findings: readonly RatedFinding[]): Rates {
  return ratesFromCounts(countFindings(findings));
}

// Threshold: don't publish trust metrics until we have enough decided
// findings to draw meaningful rates. The design's copy says "20
// enrichments"; we use "20 decided findings" — same idea in our schema.
export const INSUFFICIENT_THRESHOLD = 20;

// ─── Observed outcomes ──────────────────────────────────────────────────

export interface FirmOutcomeLike {
  firmId?: string;
  lifecycleState?: string | null;
  disposition?: string | null;
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
  /** Who reported the outcome: "market_signal" for a synthetic market signal, empty for an analyst. */
  outcomeSource?: string | null;
}

// A firm counts as "passed" (we decided not to pursue) when either its
// lifecycle landed in Passed or the disposition string says so — matches
// the definition used elsewhere in the desk for "keep passed" precedent.
export function isPassedFirm(f: FirmOutcomeLike): boolean {
  if (normalizeLifecycle(f.lifecycleState) === PASSED) {
    return true;
  }
  const disp = (f.disposition ?? "").trim().toLowerCase();
  if (disp === "") {
    return false;
  }
  return disp.includes("reject") || disp.includes("screen");
}

// Outcome slots rendered in the panels — order matters (converted first,
// then LOI, then closed, then went cold, then acquired, then null). The keys map to the
// backend vocabulary; labels come from outcomeLabel().
export const OUTCOME_SLOTS: (string | null)[] = [
  "converted_to_talks",
  "loi",
  "closed",
  "went_cold",
  ACQUIRED_BY_COMPETITOR,
  null,
];

export interface OutcomeTally {
  counts: Record<string, number>;
  passed: number;
  passedAndAcquired: number;
  /** Firms whose outcome came from a synthetic market signal rather than an analyst. */
  fromSignals: number;
}

export const NULL_OUTCOME_KEY = "__null__";

/** Firms sharing one lifecycle/disposition/outcome triple, as a GROUP BY returns them. */
export interface FirmOutcomeGroup extends FirmOutcomeLike {
  n: number;
}

export function tallyOutcomeGroups(groups: readonly FirmOutcomeGroup[]): OutcomeTally {
  const counts: Record<string, number> = {};
  for (const slot of OUTCOME_SLOTS) {
    counts[slot ?? NULL_OUTCOME_KEY] = 0;
  }
  let passed = 0;
  let passedAndAcquired = 0;
  let fromSignals = 0;
  for (const f of groups) {
    const raw = (f.outcome ?? "").trim().toLowerCase();
    if (raw !== "" && (f.outcomeSource ?? "").trim().toLowerCase() === MARKET_SIGNAL) {
      fromSignals += f.n;
    }
    const bucket = raw === "" ? NULL_OUTCOME_KEY : raw;
    if (bucket in counts) {
      counts[bucket] += f.n;
    } else {
      // Unknown outcome value — fold into the not-yet-observed bucket so it
      // still shows without breaking the fixed grid layout.
      counts[NULL_OUTCOME_KEY] += f.n;
    }
    if (isPassedFirm(f)) {
      passed += f.n;
      if (raw === ACQUIRED_BY_COMPETITOR) {
        passedAndAcquired += f.n;
      }
    }
  }
  return { counts, passed, passedAndAcquired, fromSignals };
}

export function tallyOutcomes(firms: readonly FirmOutcomeLike[]): OutcomeTally {
  return tallyOutcomeGroups(firms.map((f) => ({ ...f, n: 1 })));
}

// ─── Per-provider and per-axis tables ───────────────────────────────────

// Findings arrive with raw axis keys (either camelCase or snake_case).
// Render human labels matching the design's dataProvider.AXES vocabulary.
// The backend canonicalizes to the agent vocabulary (deal_size_usd_m,
// firm_age_years, deals_per_md_l3y, …) so the map is mostly a no-op; the
// older camelCase / short-form variants keep any residual legacy row in the
// same axis bucket instead of splitting the table.
const AXIS_LABEL: Record<string, string> = {
  coverage_model: "Sector coverage",
  coveragemodel: "Sector coverage",
  services_fit: "Services fit",
  servicesfit: "Services fit",
  md_pedigree: "MD pedigree",
  mdpedigree: "MD pedigree",
  balance_sheet_principal: "Balance sheet / principal",
  balancesheetprincipal: "Balance sheet / principal",
  deal_size: "Avg deal size",
  dealsize: "Avg deal size",
  dealsizemusd: "Avg deal size",
  dealsizeusdm: "Avg deal size",
  deals_per_md: "Deals / MD (L3Y)",
  dealspermd: "Deals / MD (L3Y)",
  dealspermdl3y: "Deals / MD (L3Y)",
  firm_age: "Firm age",
  firmage: "Firm age",
  firmageyears: "Firm age",
  employees: "Employees",
  fee_generating_count: "Fee-earning heads",
  feegeneratingcount: "Fee-earning heads",
  geographic_footprint: "Geographic fit",
  geographicfootprint: "Geographic fit",
};

function canonicalAxisKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");
}

function titleize(raw: string): string {
  return raw
    .trim()
    .split(/[_\s-]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export function axisLabel(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    return "unknown axis";
  }
  return AXIS_LABEL[canonicalAxisKey(raw)] ?? titleize(raw);
}

// Provider strings that name no data source at all. Findings carrying them
// are only meaningful as abstentions ("no source had it").
const NON_PROVIDER_VALUES = new Set(["", "none", "unknown"]);

// Authors rather than sources: the agent records abstentions, the analyst
// records values they entered themselves. Neither can be right or wrong about
// a value the way a data source can, so they get no row of their own.
const PSEUDO_PROVIDERS = new Set([AGENT, ANALYST]);

/** Key of the BY PROVIDER row that counts abstentions no real source produced. */
export const NO_SOURCE_KEY = "__none__";

// Hard-gate axes are yes/no facts captured through Beacon's gate UI, not the
// rubric. Aggregating agreement / override on binary gates with tiny sample
// sizes carries no signal, so they are dropped from BY AXIS.
const HARD_GATE_AXIS_KEYS = new Set([
  "hasstorbalancesheet",
  "advisoryconflict",
  "webactivity",
  "solvent",
]);

/**
 * Findings of one (provider, axis) pair, tallied by `classify`. Provider and
 * axis are the raw stored strings with null folded to "" (axis also trimmed).
 * Both the client (from rows) and the server (from SQL GROUP BY) produce
 * these, so one fold below builds every table from either.
 */
export interface FindingCell extends RateCounts {
  provider: string;
  axis: string;
}

export function cellsFromFindings(findings: readonly RatedFinding[]): FindingCell[] {
  const cells = new Map<string, FindingCell>();
  for (const f of findings) {
    if (isMarketSignalFinding(f)) {
      continue;
    }
    const provider = f.provider ?? "";
    const axis = (f.axis ?? "").trim();
    const key = JSON.stringify([provider, axis]);
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { provider, axis, agree: 0, override: 0, abstain: 0, total: 0 };
      cells.set(key, cell);
    }
    const cls = classify(f);
    cell.total++;
    if (cls !== "pending") {
      cell[cls]++;
    }
  }
  return [...cells.values()];
}

export interface RateRow {
  key: string;
  label: string;
  r: Rates;
}

export interface AccuracyTables {
  overall: Rates;
  byProvider: RateRow[];
  byAxis: RateRow[];
}

function sumCounts(cells: readonly RateCounts[]): RateCounts {
  const sum: RateCounts = { agree: 0, override: 0, abstain: 0, total: 0 };
  for (const c of cells) {
    sum.agree += c.agree;
    sum.override += c.override;
    sum.abstain += c.abstain;
    sum.total += c.total;
  }
  return sum;
}

function byLabel(a: RateRow, b: RateRow): number {
  return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
}

export function accuracyTables(cells: readonly FindingCell[]): AccuracyTables {
  const providers = new Map<string, FindingCell[]>();
  const noSource: FindingCell[] = [];
  for (const c of cells) {
    const provider = c.provider.trim().toLowerCase();
    // Neither a missing provider nor the agent/analyst authors are data
    // sources, so a rate against them would be misleading. Their findings
    // still count in overall and BY AXIS; their abstentions are tallied as
    // "No source" below.
    if (NON_PROVIDER_VALUES.has(provider) || PSEUDO_PROVIDERS.has(provider)) {
      noSource.push(c);
      continue;
    }
    providers.set(c.provider, [...(providers.get(c.provider) ?? []), c]);
  }
  const byProvider = [...providers.entries()]
    .map(([key, group]) => ({
      key,
      label: providerLabel(key),
      r: ratesFromCounts(sumCounts(group)),
    }))
    // Corroboration tags (multi-provider strings like "dealdb+filings") are
    // only meaningful once an analyst has decided on them; with nothing
    // decided the row would be a stat about a tag, not a data source.
    .filter((row) => row.r.total > 0 && !(row.key.includes("+") && row.r.decided === 0))
    .sort(byLabel);
  const abstained = noSource.reduce((n, c) => n + c.abstain, 0);
  if (abstained > 0) {
    byProvider.push({
      key: NO_SOURCE_KEY,
      label: "No source",
      r: ratesFromCounts({ agree: 0, override: 0, abstain: abstained, total: abstained }),
    });
  }

  // Bucket by the canonical (stripped-lowercase) axis key so residual
  // snake_case/camelCase variants land in the same row. The row is named
  // after the first variant in sort order.
  const axes = new Map<string, { key: string; label: string; cells: FindingCell[] }>();
  for (const c of [...cells].sort((a, b) => a.axis.localeCompare(b.axis))) {
    const slot = c.axis === "" ? "__unknown__" : canonicalAxisKey(c.axis);
    if (HARD_GATE_AXIS_KEYS.has(slot)) {
      continue;
    }
    const entry = axes.get(slot) ?? {
      key: c.axis === "" ? slot : c.axis,
      label: c.axis === "" ? "unknown axis" : axisLabel(c.axis),
      cells: [],
    };
    entry.cells.push(c);
    axes.set(slot, entry);
  }
  const byAxis = [...axes.values()]
    .map(({ key, label, cells: group }) => ({ key, label, r: ratesFromCounts(sumCounts(group)) }))
    .filter((row) => row.r.total > 0)
    // Most-signalled axes first.
    .sort((a, b) => b.r.total - a.r.total || byLabel(a, b));

  return { overall: ratesFromCounts(sumCounts(cells)), byProvider, byAxis };
}
