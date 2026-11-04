/**
 * Pure logic behind the Review drift queue: which passed firms share a drift's
 * now-stale reason, and how a drift's resolution reads. No React, no DOM.
 */

// ─── Changed-axes parser ────────────────────────────────────────────────
// DriftEvent.changedAxes is a JSON string. The SDK description says
// [{axis, old, new, causing_finding_id, source, dated}] but the backend
// actually emits {oldValue, newValue} (or old_value / new_value) — read
// all three shapes so the card renders real values regardless.

export interface ChangedAxis {
  axis?: string;
  old?: unknown;
  new?: unknown;
  source?: string;
  dated?: string;
}

function normalizeChangedAxis(entry: Record<string, unknown>): ChangedAxis {
  return {
    axis: typeof entry.axis === "string" ? entry.axis : undefined,
    old: entry.old ?? entry.oldValue ?? entry.old_value,
    new: entry.new ?? entry.newValue ?? entry.new_value,
    source: typeof entry.source === "string" ? entry.source : undefined,
    dated:
      typeof entry.dated === "string"
        ? entry.dated
        : typeof entry.date === "string"
          ? entry.date
          : undefined,
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

/**
 * Passed firms whose latest rejection reason matches one of the drift's
 * changed axes, excluding the drift's own firm. `reasons` is the
 * latestRejection() map, newest decision first; the result follows that order
 * and holds at most MAX_LOOKALIKES firms.
 */
export function lookalikesFor<F extends { firmId?: string | null }>(
  drift: { firmId?: string | null; changedAxes?: string | null },
  passedFirms: readonly F[],
  reasons: ReadonlyMap<string, ReasonLike>,
): F[] {
  const axes = parseChangedAxes(drift.changedAxes)
    .map((c) => c.axis)
    .filter((a): a is string => typeof a === "string" && a !== "");
  if (axes.length === 0) {
    return [];
  }
  const passedById = new Map<string, F>();
  for (const f of passedFirms) {
    if (f.firmId) {
      passedById.set(f.firmId, f);
    }
  }
  const hits: F[] = [];
  for (const [firmId, decision] of reasons) {
    const firm = passedById.get(firmId);
    if (firm === undefined || firmId === drift.firmId) {
      continue;
    }
    const text = reasonText(decision);
    if (text !== "" && axes.some((ax) => reasonMatchesAxis(text, ax))) {
      hits.push(firm);
      if (hits.length === MAX_LOOKALIKES) {
        break;
      }
    }
  }
  return hits;
}

// ─── Resolutions ────────────────────────────────────────────────────────

/** Every DriftEvent.resolution the server writes (server/actions/drift.ts). */
export const RESOLUTION_LABEL: Readonly<Record<string, string>> = {
  re_engaged: "Re-engaged",
  kept_passed: "Kept passed",
  kept_in_pipeline: "Kept in pipeline",
  passed: "Passed",
};

export function resolutionLabel(resolution: string | null | undefined): string {
  const raw = (resolution ?? "").trim();
  if (raw === "") {
    return "Resolved";
  }
  const known = RESOLUTION_LABEL[raw];
  if (known !== undefined) {
    return known;
  }
  const spaced = raw.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
