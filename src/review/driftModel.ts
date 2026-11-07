/**
 * What the Review page shows, as plain data: each drift event paired with its firm, the reason the
 * firm was passed, the market outcome and the passed firms that share a stale reason, and how an
 * event reads as a row. Pure: no React, no data access.
 */
import { type ReasonLike, lookalikesFor, reasonText, resolutionLabel } from "@/desk/driftReview";
import { latestRejection } from "@/desk/pipelineRows";
import { type DriftReasonStyle, driftReasonPresentation, isOutcomeDivergence } from "@/desk/tokens";
import { PASSED, firmIsGone, isQualifiedOrLater, normalizeLifecycle } from "../../shared/vocab";
import { relativeAge, toIsoTime } from "../home/age";
import { direction, tierLabel } from "../home/needsRows";

export interface DriftLike {
  driftEventId: string;
  firmId?: string;
  changedAxes?: string;
  detectedAt?: unknown;
  driftReason?: string;
  driftStatus?: string;
  newScore?: number;
  newTier?: string;
  priorScore?: number;
  priorTier?: string;
  resolution?: string;
  resolvedAt?: unknown;
  resolvedBy?: string;
}

export interface FirmLike {
  firmId?: string;
  firmName?: string | null;
  lifecycleState?: string | null;
  // FDE backfills these on decided firms; not yet in the SDK PropertyKeys
  // for Firm — same widened-cast pattern the desk uses.
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
}

/** The ReviewDecision fields the page reads. */
export interface DecisionLike extends ReasonLike {
  firmId?: string | null;
  decisionType?: string | null;
}

export interface Lookalike {
  firmId: string;
  firmName: string;
}

export interface LookalikeSet {
  firms: Lookalike[];
  total: number;
}

export const NO_LOOKALIKES: LookalikeSet = { firms: [], total: 0 };

/** Passed firms are offered a way back in; firms still in the pipeline a way to stay or go. */
export type DriftKind = "passed" | "pipeline";

export interface DriftItem {
  drift: DriftLike;
  firmName: string;
  /** The Firm record the actions are applied to; undefined until it has loaded. */
  firm: FirmLike | undefined;
  resolved: boolean;
  /** Which decisions are on offer; null when the firm is not at a stage that has any. */
  kind: DriftKind | null;
  /** A Closed firm is done: nothing left to pass on, only the drift to note. */
  canPass: boolean;
  /**
   * The market outcome says the firm is gone (acquired by a competitor): there is nothing left to
   * re-engage, so a passed firm is offered recording the lesson instead.
   */
  firmGone: boolean;
  /**
   * Keeping this event's firm passed records the lesson: the event is the acquisition itself. An
   * earlier event on a firm that was acquired later was settled before the acquisition and keeps
   * its own wording.
   */
  lessonRecorded: boolean;
  lookalikes: LookalikeSet;
  /** Why the firm was passed: its newest reject decision. Only read for outcome_diverged. */
  rejectionReason: string | null;
  /** The market outcome backfilled on the firm. Only read for outcome_diverged. */
  observedOutcome: string | null;
}

export const isResolved = (d: DriftLike): boolean =>
  (d.driftStatus ?? "").toLowerCase() === "resolved";

export function kindFor(firm: FirmLike | undefined): DriftKind | null {
  if (firm === undefined) {
    return null;
  }
  const state = normalizeLifecycle(firm.lifecycleState);
  return state === PASSED ? "passed" : isQualifiedOrLater(state) ? "pipeline" : null;
}

/**
 * Pair every drift event with what its card needs. Open events come first and resolved ones
 * after; within each, the order of `drifts` (newest first) is kept. `decisions` must be newest
 * first too, so the first reject decision per firm is its pass reason: later keep_passed and
 * acknowledge_drift decisions are about the drift, not the original pass.
 */
export function buildDriftItems(
  drifts: readonly DriftLike[],
  firms: readonly FirmLike[],
  decisions: Iterable<DecisionLike>,
): { open: DriftItem[]; resolved: DriftItem[] } {
  const firmById = new Map<string, FirmLike>();
  for (const f of firms) {
    if (f.firmId) {
      firmById.set(f.firmId, f);
    }
  }
  const rejections = latestRejection(decisions);
  const passedFirms = firms.filter(
    (f) => !!f.firmId && normalizeLifecycle(f.lifecycleState) === PASSED,
  );

  const toItem = (d: DriftLike): DriftItem => {
    const firmId = d.firmId ?? "";
    const firm = firmById.get(firmId);
    const resolved = isResolved(d);
    let lookalikes = NO_LOOKALIKES;
    if (!resolved && d.driftReason === "pass_reason_invalidated") {
      // Other passed firms whose reason cites the same axis may be stale too.
      const found = lookalikesFor(d, passedFirms, rejections);
      if (found.total > 0) {
        lookalikes = {
          total: found.total,
          firms: found.firms.map((f) => ({
            firmId: f.firmId ?? "",
            firmName: f.firmName ?? f.firmId ?? "",
          })),
        };
      }
    }
    const outcome = (firm?.outcome ?? "").trim();
    return {
      drift: d,
      firmName: firm?.firmName ?? (firmId === "" ? "Unknown firm" : firmId),
      firm,
      resolved,
      kind: kindFor(firm),
      canPass: normalizeLifecycle(firm?.lifecycleState) !== "Closed",
      firmGone: firmIsGone(firm?.outcome),
      lessonRecorded: isOutcomeDivergence(d.driftReason) && firmIsGone(firm?.outcome),
      lookalikes,
      rejectionReason: resolved ? null : reasonText(rejections.get(firmId)) || null,
      observedOutcome: resolved || outcome === "" ? null : outcome,
    };
  };

  const open: DriftItem[] = [];
  const resolved: DriftItem[] = [];
  for (const d of drifts) {
    (isResolved(d) ? resolved : open).push(toItem(d));
  }
  return { open, resolved };
}

// ─── Rows ───────────────────────────────────────────────────────────────

/** Which mark a row carries; the page maps these to colour (see DriftList.module.css). */
export type DriftTone = "down" | "up" | "attention" | "divergence";

export interface DriftRowModel {
  id: string;
  name: string;
  resolved: boolean;
  /** One glyph that names the kind of drift. */
  mark: string;
  tone: DriftTone;
  /** The trigger, in words. */
  reason: string;
  /** The tier change, as it reads in the row. */
  figure: { from: string; to: string } | null;
  /** Whether the firm moved up, down or neither; colours the "to" end of the figure. */
  moved: "up" | "down" | "flat";
  /** How the event was settled; set only on resolved events. */
  resolution: string | null;
  /** Time since detection ("3d"); null when none was recorded. */
  age: string | null;
}

/** The reason's chip: label and colours (shared with Home, so the violet reads the same). */
export function reasonStyle(d: DriftLike): DriftReasonStyle {
  return driftReasonPresentation(d.driftReason);
}

/** How one drift event reads as a row of the queue. */
export function driftRow(item: DriftItem, now: number): DriftRowModel {
  const d = item.drift;
  const from = tierLabel(d.priorTier, d.priorScore);
  const to = tierLabel(d.newTier, d.newScore);
  const figure = from !== null && to !== null ? { from, to } : null;
  const dir = direction(d.priorTier, d.priorScore, d.newTier, d.newScore);
  const base = {
    moved: dir < 0 ? ("down" as const) : dir > 0 ? ("up" as const) : ("flat" as const),
    id: d.driftEventId,
    name: item.firmName,
    resolved: item.resolved,
    figure,
    resolution: item.resolved ? resolutionLabel(d.resolution, item.lessonRecorded) : null,
    age: relativeAge(toIsoTime(d.detectedAt), now),
  };
  if (isOutcomeDivergence(d.driftReason)) {
    return {
      ...base,
      mark: "≠",
      tone: "divergence",
      reason: "passed; later acquired by a competitor",
      figure: null,
    };
  }
  if (d.driftReason === "pass_reason_invalidated") {
    return {
      ...base,
      mark: "!",
      tone: "attention",
      reason: "the reason we passed no longer holds",
    };
  }
  return {
    ...base,
    mark: dir < 0 ? "↓" : dir > 0 ? "↑" : "!",
    tone: dir < 0 ? "down" : dir > 0 ? "up" : "attention",
    reason: d.driftReason === "tier_moved" ? "tier moved after new evidence" : "drift detected",
  };
}

// ─── Detail ─────────────────────────────────────────────────────────────

export function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined) {
    return "—";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return "?";
  }
}

/** "3d ago" for a recorded date, the date as written when it is not a time, null when empty. */
export function agoText(raw: unknown, now: number): string | null {
  const age = relativeAge(toIsoTime(raw), now);
  if (age !== null) {
    return age === "now" ? "just now" : `${age} ago`;
  }
  return typeof raw === "string" && raw !== "" ? raw : null;
}
