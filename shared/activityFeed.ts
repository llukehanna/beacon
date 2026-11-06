/**
 * The Home "agent activity" feed and its one-line headline.
 *
 * Pure: every item is derived from a timestamp already on a row, so nothing
 * here claims a time, a count or a duration the data does not hold. A thing
 * with no recorded time (a drift event, a rule proposed before its time was kept) is left out of the
 * feed rather than given an invented one.
 *
 * What counts as a "run": the agent writes every finding of one enrichment at
 * one instant, so a firm's findings sharing a `retrievedAt` are one run.
 */
import { isAbstainedFinding, isVerifiedFinding } from "./axisState.js";
import { axisLabel } from "./trustMetrics.js";
import { AGENT, ANALYST, MARKET_SIGNAL, providerLabel } from "./vocab.js";

export type ActivityKind = "enriched" | "conflict" | "abstained" | "rule_proposed" | "drift";

export interface ActivityItem {
  kind: ActivityKind;
  /** ISO timestamp of the event. */
  at: string;
  firmId: string | null;
  title: string;
  detail: string;
}

export interface HeadlineCounts {
  /** Firms whose `enrichedAt` falls in the window. */
  enrichedFirms: number;
  /** Distinct (firm, axis) pairs the window's runs left abstained. */
  abstainedAxes: number;
  /** The window is this many hours, ending at the latest `enrichedAt`. */
  windowHours: 24;
}

export interface ActivityFirm {
  firmId: string;
  firmName?: string | null;
  enrichedAt?: string | null;
}

export interface ActivityFinding {
  firmId?: string | null;
  axis?: string | null;
  value?: string | null;
  provider?: string | null;
  findingStatus?: string | null;
  confidenceTier?: string | null;
  verifiedByHuman?: boolean | null;
  conflictGroupId?: string | null;
  sourceQuote?: string | null;
  retrievedAt?: string | null;
}

export interface ActivityRule {
  proposedRuleId: string;
  /** Plain-English predicate, e.g. "employees < 10". */
  text: string;
  /** When the rule was proposed; null when that was not recorded. */
  proposedAt: string | null;
  supportingFirmCount?: number | null;
}

export interface ActivityDrift {
  driftEventId: string;
  firmId?: string | null;
  detectedAt?: string | null;
  reason?: string | null;
  priorTier?: string | null;
  newTier?: string | null;
}

export interface ActivityInput {
  firms: readonly ActivityFirm[];
  findings: readonly ActivityFinding[];
  proposedRules?: readonly ActivityRule[];
  driftEvents?: readonly ActivityDrift[];
}

export const FEED_LIMIT = 7;
const WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

/** Same-kind ties resolve in this order. */
const KIND_ORDER: Record<ActivityKind, number> = {
  enriched: 0,
  conflict: 1,
  abstained: 2,
  rule_proposed: 3,
  drift: 4,
};

/** Axis names listed in a detail line before "+N more". */
const NAMED = 3;

function ms(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === "") {
    return null;
  }
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const hasQuote = (f: ActivityFinding) => (f.sourceQuote ?? "").trim() !== "";
const inConflictGroup = (f: ActivityFinding) => (f.conflictGroupId ?? "") !== "";
const isSuperseded = (f: ActivityFinding) => lower(f.findingStatus) === "superseded";

/** axisState's predicates take optional fields; these rows carry nullable ones. */
const asLike = (f: ActivityFinding) => ({
  findingId: "",
  confidenceTier: f.confidenceTier ?? undefined,
  findingStatus: f.findingStatus ?? undefined,
  verifiedByHuman: f.verifiedByHuman ?? undefined,
});
const abstained = (f: ActivityFinding) => isAbstainedFinding(asLike(f));
const verified = (f: ActivityFinding) => isVerifiedFinding(asLike(f));

/** Strings an agent records for "no source" rather than for a source. */
const NOT_A_SOURCE = new Set(["", "none", "unknown", AGENT, ANALYST]);

function sourcesOf(findings: readonly ActivityFinding[]): number {
  const keys = new Set<string>();
  for (const f of findings) {
    for (const part of (f.provider ?? "").split("+")) {
      const key = lower(part);
      if (!NOT_A_SOURCE.has(key)) {
        keys.add(key);
      }
    }
  }
  return keys.size;
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const g = out.get(k);
    if (g) {
      g.push(r);
    } else {
      out.set(k, [r]);
    }
  }
  return out;
}

const list = (names: readonly string[]) =>
  names.length <= NAMED
    ? names.join(", ")
    : `${names.slice(0, NAMED).join(", ")} +${names.length - NAMED} more`;

/**
 * Axes where an agent abstained, nothing settled it since, and it was not
 * replaced by a later run. Conflict-grouped findings are conflicts, not
 * abstentions (the same line Home's needs-you count draws).
 */
function standingAbstentions(
  findings: readonly ActivityFinding[],
): { firmId: string; axis: string; at: number }[] {
  const settled = new Set(
    findings.filter((f) => verified(f)).map((f) => `${f.firmId ?? ""}\u0000${f.axis ?? ""}`),
  );
  const out = new Map<string, { firmId: string; axis: string; at: number }>();
  for (const f of findings) {
    const at = ms(f.retrievedAt);
    const firmId = f.firmId ?? "";
    const axis = f.axis ?? "";
    const key = `${firmId}\u0000${axis}`;
    if (
      at === null ||
      firmId === "" ||
      isSuperseded(f) ||
      inConflictGroup(f) ||
      !abstained(f) ||
      settled.has(key)
    ) {
      continue;
    }
    const prev = out.get(key);
    if (prev === undefined || at > prev.at) {
      out.set(key, { firmId, axis, at });
    }
  }
  return [...out.values()];
}

/**
 * Per firm, when its latest standing abstention was recorded: how long it has had an axis waiting
 * for a judgment. A firm with none is absent.
 */
export function abstainedSinceByFirm(findings: readonly ActivityFinding[]): Map<string, string> {
  const latest = new Map<string, number>();
  for (const a of standingAbstentions(findings)) {
    latest.set(a.firmId, Math.max(latest.get(a.firmId) ?? 0, a.at));
  }
  return new Map([...latest].map(([firmId, t]) => [firmId, new Date(t).toISOString()]));
}

const DRIFT_REASON: Record<string, string> = {
  tier_moved: "Tier moved",
  pass_reason_invalidated: "Pass reason invalidated",
  outcome_diverged: "Outcome diverged",
};

function driftDetail(d: ActivityDrift): string {
  const raw = lower(d.reason);
  const label =
    DRIFT_REASON[raw] ??
    (raw === "" ? "Drift" : raw[0].toUpperCase() + raw.slice(1).replace(/_/g, " "));
  const prior = (d.priorTier ?? "").trim();
  const next = (d.newTier ?? "").trim();
  return prior !== "" && next !== "" && prior !== next ? `${label} · ${prior} → ${next}` : label;
}

export function buildActivity(input: ActivityInput, limit = FEED_LIMIT): ActivityItem[] {
  const nameOf = new Map(input.firms.map((f) => [f.firmId, f.firmName?.trim() || f.firmId]));
  const name = (firmId: string) => nameOf.get(firmId) ?? firmId;
  const items: (ActivityItem & { ms: number })[] = [];
  const push = (
    kind: ActivityKind,
    atMs: number,
    firmId: string | null,
    title: string,
    detail: string,
  ) => items.push({ kind, at: new Date(atMs).toISOString(), ms: atMs, firmId, title, detail });

  const scoped = input.findings.filter((f) => (f.firmId ?? "") !== "");

  // Enriched: one item per firm per run, counted from what that run wrote.
  const agentFindings = scoped.filter(
    (f) =>
      lower(f.provider) !== ANALYST &&
      lower(f.provider) !== MARKET_SIGNAL &&
      ms(f.retrievedAt) !== null,
  );
  for (const run of groupBy(
    agentFindings,
    (f) => `${f.firmId}\u0000${ms(f.retrievedAt)}`,
  ).values()) {
    const firmId = run[0].firmId as string;
    const values = run.filter((f) => !abstained(f));
    const conflicts = new Set(run.map((f) => f.conflictGroupId ?? "").filter((g) => g !== ""));
    push(
      "enriched",
      ms(run[0].retrievedAt) as number,
      firmId,
      `${name(firmId)} enriched`,
      `${plural(sourcesOf(values), "source")} · ${plural(values.filter(hasQuote).length, "value")} grounded · ${plural(conflicts.size, "conflict")}`,
    );
  }

  // Conflict: one item per firm that still has a group of competing proposals.
  const open = scoped.filter((f) => inConflictGroup(f) && lower(f.findingStatus) === "proposed");
  for (const [firmId, rows] of groupBy(open, (f) => f.firmId as string)) {
    const groups = [...groupBy(rows, (f) => f.conflictGroupId as string).values()]
      .filter((g) => g.length >= 2)
      .map((g) =>
        [...g].sort(
          (a, b) =>
            lower(a.provider).localeCompare(lower(b.provider)) ||
            (a.value ?? "").localeCompare(b.value ?? ""),
        ),
      )
      .sort((a, b) => (a[0].axis ?? "").localeCompare(b[0].axis ?? ""));
    if (groups.length === 0) {
      continue;
    }
    const [first, second] = groups[0];
    const side = (f: ActivityFinding) =>
      `${providerLabel(f.provider ?? "")} ${f.value ?? "no value"}`.trim();
    const more = groups.length > 1 ? ` (+${groups.length - 1} more)` : "";
    const latest = Math.max(...groups.flat().map((f) => ms(f.retrievedAt) ?? 0));
    if (latest === 0) {
      continue;
    }
    push(
      "conflict",
      latest,
      firmId,
      `${name(firmId)}: sources disagree`,
      `${axisLabel(first.axis ?? undefined)}: ${side(first)} vs ${side(second)}${more}`,
    );
  }

  // Abstained: one item per firm with an axis no source could fill.
  for (const [firmId, rows] of groupBy(standingAbstentions(input.findings), (a) => a.firmId)) {
    const axes = [...new Set(rows.map((r) => axisLabel(r.axis)))].sort();
    push(
      "abstained",
      Math.max(...rows.map((r) => r.at)),
      firmId,
      `${name(firmId)}: abstained on ${plural(axes.length, "axis", "axes")}`,
      `No source had ${list(axes)}`,
    );
  }

  for (const r of input.proposedRules ?? []) {
    const t = ms(r.proposedAt);
    if (t === null) {
      continue;
    }
    const n = r.supportingFirmCount ?? 0;
    push("rule_proposed", t, null, `Rule proposed: ${r.text}`, `Supported by ${plural(n, "firm")}`);
  }

  for (const d of input.driftEvents ?? []) {
    const t = ms(d.detectedAt);
    const firmId = d.firmId ?? null;
    if (t === null) {
      continue;
    }
    push(
      "drift",
      t,
      firmId,
      `${firmId === null ? "A firm" : name(firmId)}: drift detected`,
      driftDetail(d),
    );
  }

  return items
    .sort(
      (a, b) =>
        b.ms - a.ms ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.firmId ?? "").localeCompare(b.firmId ?? "") ||
        a.title.localeCompare(b.title),
    )
    .slice(0, Math.max(0, limit))
    .map(({ ms: _ms, ...item }) => item);
}

/**
 * What the agent's latest runs did: the 24 hours ending at the latest
 * `enrichedAt` of any firm. Null when no firm has ever been enriched.
 */
export function latestRunHeadline(input: ActivityInput): HeadlineCounts | null {
  const times = input.firms.map((f) => ms(f.enrichedAt));
  const stamped = times.filter((t): t is number => t !== null);
  if (stamped.length === 0) {
    return null;
  }
  const end = Math.max(...stamped);
  const start = end - WINDOW_HOURS * HOUR_MS;
  const abstainedAxes = standingAbstentions(input.findings).filter(
    (a) => a.at >= start && a.at <= end,
  ).length;
  return {
    enrichedFirms: stamped.filter((t) => t >= start).length,
    abstainedAxes,
    windowHours: WINDOW_HOURS,
  };
}
