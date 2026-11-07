/**
 * Pure logic behind the Review drift queue: which passed firms share a drift's
 * now-stale reason, and how a drift's resolution reads. No React, no DOM.
 */

// ─── Changed-axes parser ────────────────────────────────────────────────
// DriftEvent.changedAxes is a JSON string. The SDK description says
// [{axis, old, new, causing_finding_id, source}] but the backend
// actually emits {oldValue, newValue} (or old_value / new_value) — read
// all three shapes so the card renders real values regardless.

export interface ChangedAxis {
  axis?: string;
  old?: unknown;
  new?: unknown;
  source?: string;
}

function normalizeChangedAxis(entry: Record<string, unknown>): ChangedAxis {
  return {
    axis: typeof entry.axis === "string" ? entry.axis : undefined,
    old: entry.old ?? entry.oldValue ?? entry.old_value,
    new: entry.new ?? entry.newValue ?? entry.new_value,
    source: typeof entry.source === "string" ? entry.source : undefined,
  };
}

export function parseChangedAxes(raw: string | null | undefined): ChangedAxis[] {
  if (raw === null || raw === undefined || raw === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const objects = parsed.filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
    );
    return objects.map(normalizeChangedAxis);
  } catch {
    return [];
  }
}

// ─── Lookalikes ─────────────────────────────────────────────────────────
// A drift's changed axes are matched against the reasons firms were passed.
// The match is a fuzzy, case-insensitive substring across a few axis-name
// shapes (raw, snake→space, camel→space). False positives happen when a
// reason mentions an axis word incidentally; false negatives when the analyst
// paraphrased. The card surfaces the firm names so the analyst can judge.

export const MAX_LOOKALIKES = 9;

function axisSearchTerms(axis: string): string[] {
  const trimmed = axis.trim();
  if (trimmed === "") {
    return [];
  }
  const lower = trimmed.toLowerCase();
  const terms = new Set<string>([
    lower,
    lower.replace(/_/g, " "),
    lower.replace(/-/g, " "),
    trimmed
      .replace(/([A-Z])/g, " $1")
      .trim()
      .toLowerCase(),
  ]);
  // Terms under 4 characters collide with ordinary words in rationale text.
  return [...terms].filter((t) => t.length >= 4);
}

function reasonMatchesAxis(reason: string, axis: string): boolean {
  const haystack = reason.toLowerCase();
  return axisSearchTerms(axis).some((t) => haystack.includes(t));
}

/** The decision fields the reason text is read from. */
export interface ReasonLike {
  rejectionRationale?: string | null;
  analystCategorization?: string | null;
}

export function reasonText(d: ReasonLike | undefined): string {
  return ((d?.rejectionRationale ?? "").trim() || (d?.analystCategorization ?? "").trim()).trim();
}

export interface Lookalikes<F> {
  /** The newest MAX_LOOKALIKES matches, newest rejection first. */
  firms: F[];
  /** Every match, so the count stays true past the cap. */
  total: number;
}

/**
 * Other passed firms whose latest rejection reason cites the same axis that
 * invalidated this drifted firm's own pass reason. The axes in play are the
 * drift's changed axes that the drifted firm's own rejection reason matches;
 * with none, there is no shared reason and nothing to show. `reasons` is the
 * latestRejection() map, newest decision first, and the result follows that
 * order.
 */
export function lookalikesFor<F extends { firmId?: string | null }>(
  drift: { firmId?: string | null; changedAxes?: string | null },
  passedFirms: readonly F[],
  reasons: ReadonlyMap<string, ReasonLike>,
): Lookalikes<F> {
  const none: Lookalikes<F> = { firms: [], total: 0 };
  const ownReason = reasonText(reasons.get(drift.firmId ?? ""));
  if (ownReason === "") {
    return none;
  }
  const staleAxes = parseChangedAxes(drift.changedAxes)
    .map((c) => c.axis)
    .filter((a): a is string => typeof a === "string" && a !== "")
    .filter((ax) => reasonMatchesAxis(ownReason, ax));
  if (staleAxes.length === 0) {
    return none;
  }
  const passedById = new Map<string, F>();
  for (const f of passedFirms) {
    if (f.firmId) {
      passedById.set(f.firmId, f);
    }
  }
  const matches: F[] = [];
  for (const [firmId, decision] of reasons) {
    const firm = passedById.get(firmId);
    if (firm === undefined || firmId === drift.firmId) {
      continue;
    }
    const text = reasonText(decision);
    if (text !== "" && staleAxes.some((ax) => reasonMatchesAxis(text, ax))) {
      matches.push(firm);
    }
  }
  return { firms: matches.slice(0, MAX_LOOKALIKES), total: matches.length };
}

// ─── Resolutions ────────────────────────────────────────────────────────

/** Every DriftEvent.resolution the server writes (server/actions/drift.ts). */
export const RESOLUTION_LABEL: Readonly<Record<string, string>> = {
  re_engaged: "Re-engaged",
  kept_passed: "Kept passed",
  kept_in_pipeline: "Kept in pipeline",
  passed: "Passed",
};

// A Map, so a stray value like "constructor" can't resolve through the prototype.
const RESOLUTION_BY_VALUE: ReadonlyMap<string, string> = new Map(Object.entries(RESOLUTION_LABEL));

export function resolutionLabel(
  resolution: string | null | undefined,
  /** True when the firm has since been acquired: keeping it passed then records the lesson. */
  firmGone = false,
): string {
  const raw = (resolution ?? "").trim();
  if (firmGone && raw === "kept_passed") {
    return "Lesson recorded";
  }
  if (raw === "") {
    return "Resolved";
  }
  const known = RESOLUTION_BY_VALUE.get(raw);
  if (known !== undefined) {
    return known;
  }
  const spaced = raw.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
