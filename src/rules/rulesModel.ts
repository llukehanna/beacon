// Pure helpers behind the Rules page: the shapes the page reads off ProposedRule and
// HardScreenConfig rows, who decided, version history, ordering and predicate wording.
import { summarizePredicate } from "@/desk/rulePredicate";

export interface RuleLike {
  proposedRuleId: string;
  mandateScope?: string;
  predicateAxis?: string;
  projectedScreenCount?: number;
  rationaleClusterSummary?: string;
  ruleDecidedAt?: unknown;
  ruleDecidedBy?: string;
  ruleModel?: string;
  ruleOperator?: string;
  ruleStatus?: string;
  ruleThreshold?: string;
  supportingDecisionIds?: string;
  supportingFirmCount?: number;
}

export interface DecisionLike {
  decisionId: string;
  firmId?: string;
  rejectionRationale?: string | null;
  decidedAt?: unknown;
}

/**
 * One HardScreenConfig row is one rule version. Amending a threshold deactivates the current row
 * and inserts a new one with configVersion + 1; unapproving deactivates every row of the rule.
 */
export interface ConfigLike {
  configRuleId: string;
  sourceProposedRuleId?: string;
  configVersion?: number;
  configActive?: boolean;
  configAxis?: string;
  configOperator?: string;
  configThreshold?: string;
  configAuthor?: string;
  configCreatedAt?: unknown;
}

export interface RuleVersions {
  /** Ascending by configVersion, so history reads v1 → v2 → v3. */
  all: ConfigLike[];
  /** Highest configVersion with configActive === true; null when every version is inactive. */
  activeLatest: ConfigLike | null;
}

export const NO_VERSIONS: RuleVersions = { all: [], activeLatest: null };

export type RuleStatus = "pending" | "approved" | "dismissed";

/** The rule's status, lowercased; a rule with none yet is pending. */
export function statusOf(rule: RuleLike): string {
  return (rule.ruleStatus ?? "pending").toLowerCase();
}

// ruleDecidedBy was backfilled with raw user ids. An id in prose reads as garbage, and Beacon has
// one analyst, so a decider that cannot be resolved to a name is "you".
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function displayDecider(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  return s === "" || UUID_LIKE.test(s) ? "you" : s;
}

/**
 * Word-boundary truncation: rewinds a hard character cap to the last space or separator inside a
 * snake_case token, so the tail reads "geographic_footprint ==…" rather than "geographic footpri".
 */
export function truncatePredicateAtWord(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const clipped = trimmed.slice(0, max);
  const lastSep = Math.max(
    clipped.lastIndexOf(" "),
    clipped.lastIndexOf("_"),
    clipped.lastIndexOf("-"),
  );
  const cut = lastSep > max * 0.5 ? clipped.slice(0, lastSep) : clipped;
  return cut.trimEnd() + "…";
}

/** The decision ids behind a rule: a JSON array, or a comma-separated list. */
export function parseSupportingIds(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // Not JSON: fall through to the comma-separated form.
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Config rows grouped by the rule they belong to, each group in version order. */
export function groupVersions(configs: readonly ConfigLike[]): Map<string, RuleVersions> {
  const byRule = new Map<string, ConfigLike[]>();
  for (const c of configs) {
    const id = c.sourceProposedRuleId ?? "";
    if (id === "") {
      continue;
    }
    const rows = byRule.get(id) ?? [];
    rows.push(c);
    byRule.set(id, rows);
  }
  const out = new Map<string, RuleVersions>();
  for (const [id, rows] of byRule) {
    const all = [...rows].sort((a, b) => (a.configVersion ?? 0) - (b.configVersion ?? 0));
    const active = all.filter((c) => c.configActive === true);
    out.set(id, { all, activeLatest: active[active.length - 1] ?? null });
  }
  return out;
}

/**
 * The predicate the engine screens on: the latest active config row when there is one, otherwise
 * the proposal's own fields (an approval that has just landed, or configs still loading). Null when
 * a component is missing.
 */
export function effectivePredicate(rule: RuleLike, versions: RuleVersions): string | null {
  const c = versions.activeLatest;
  return (
    (c && summarizePredicate(c.configAxis, c.configOperator, c.configThreshold)) ??
    summarizePredicate(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold)
  );
}

/** "v1: a → v2: b": the predicate of each version, oldest first. */
export function versionHistory(versions: RuleVersions): string {
  return versions.all
    .map((c) => {
      const predicate = summarizePredicate(c.configAxis, c.configOperator, c.configThreshold);
      return `v${c.configVersion ?? "?"}: ${predicate ?? "—"}`;
    })
    .join(" → ");
}

/** The version number shown on an active rule: the active row's, else the latest on file. */
export function currentVersion(versions: RuleVersions): number | undefined {
  return (
    versions.activeLatest?.configVersion ?? versions.all[versions.all.length - 1]?.configVersion
  );
}

export interface RuleGroups {
  pending: RuleLike[];
  approved: RuleLike[];
  /** Declined, and any status this page does not know. */
  declined: RuleLike[];
}

export function groupRules(rules: readonly RuleLike[]): RuleGroups {
  const groups: RuleGroups = { pending: [], approved: [], declined: [] };
  for (const r of rules) {
    const s = statusOf(r);
    (s === "pending" ? groups.pending : s === "approved" ? groups.approved : groups.declined).push(
      r,
    );
  }
  return groups;
}

export function formatNoteDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** What an active rule's row has open under it: its details, and at most one change form. */
export interface RowOpen {
  detailsOpen: boolean;
  mode: "amend" | "unapprove" | null;
}

/**
 * The row's "Details" / "Hide details" button. It reads "Hide details" whenever anything is open,
 * so with a change form open it closes the form and leaves the details closed; otherwise it
 * toggles the details.
 */
export function toggleDetails(open: RowOpen): RowOpen {
  if (open.mode !== null) {
    return { detailsOpen: false, mode: null };
  }
  return { detailsOpen: !open.detailsOpen, mode: null };
}
