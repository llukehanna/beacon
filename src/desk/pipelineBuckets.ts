/**
 * Pipeline lifecycle vocabulary — the eight-stage funnel plus the Passed outcome.
 *
 * Extracted from Pipeline.tsx so the Home funnel strip and the Pipeline
 * page compute stage membership from ONE function. If these diverged the
 * home tile and the page it links to would disagree about the same firm,
 * which is exactly the failure the "every number links" rule exists to
 * prevent.
 */
import {
  LIFECYCLE_STAGES,
  type LifecycleState,
  PASSED,
  normalizeLifecycle,
} from "../../shared/vocab";
import type { MirrorResult } from "./scoreMirror";

export const LIFECYCLE_BUCKETS = [...LIFECYCLE_STAGES, PASSED] as const;

/** A funnel stage, or the Passed outcome. */
export type Lifecycle = LifecycleState;

// Status chip palette — mirrors support.js:statusChipStyle().
export interface StatusStyle {
  bg: string;
  fg: string;
  dot: string;
}

const ACCENT_STEP = (pct: number): StatusStyle => ({
  bg: `color-mix(in srgb, var(--color-accent) ${pct}%, transparent)`,
  fg: "var(--color-accent-100)",
  dot: "var(--color-accent)",
});

export const STATUS_CHIP: Record<Lifecycle, StatusStyle> = {
  Discovered: {
    bg: "var(--color-neutral-800)",
    fg: "var(--color-neutral-200)",
    dot: "var(--color-neutral-500)",
  },
  Screening: {
    bg: "var(--color-accent-2-800)",
    fg: "var(--color-accent-2-100)",
    dot: "var(--color-accent-400)",
  },
  Qualified: {
    bg: "rgba(87,185,138,.18)",
    fg: "#8fe3c0",
    dot: "#57b98a",
  },
  Outreach: {
    bg: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
    fg: "var(--color-accent-200)",
    dot: "var(--color-accent-500)",
  },
  NDA: ACCENT_STEP(22),
  IOI: ACCENT_STEP(30),
  LOI: {
    bg: "var(--color-accent-800)",
    fg: "var(--color-accent-100)",
    dot: "var(--color-accent)",
  },
  Closed: {
    bg: "rgba(87,185,138,.30)",
    fg: "#b5f0d8",
    dot: "#57b98a",
  },
  Passed: {
    bg: "var(--color-neutral-800)",
    fg: "color-mix(in srgb, var(--color-text) 55%, transparent)",
    dot: "var(--color-neutral-600)",
  },
};

// Minimal firm shape the bucket derivation reads. Both Pipeline's FirmView
// and Home's firm rows structurally satisfy it.
export interface BucketFirm {
  lifecycleState?: string | null;
  currentStage?: string | null;
  disposition?: string | null;
}

/**
 * A firm's canonical bucket for the pipeline:
 * - mirror.hardRejected → "Passed"
 * - currentStage / lifecycleState, normalized (legacy names included)
 * - disposition says rejected → "Passed"
 * - else → "Discovered"
 */
export function bucketOf(firm: BucketFirm, mirror: MirrorResult): Lifecycle {
  return bucketOfHardRejected(firm, mirror.hardRejected);
}

/**
 * `bucketOf` for callers that already know the hard-reject verdict and don't
 * want to re-run mirrorScore. The desk's ranker computes it per firm during
 * ordering, so re-deriving a MirrorResult for all 700-odd rows just to read
 * one boolean back off it would be wasted work.
 */
export function bucketOfHardRejected(firm: BucketFirm, hardRejected: boolean): Lifecycle {
  if (hardRejected) {
    return PASSED;
  }
  const raw = (firm.currentStage ?? "").trim() !== "" ? firm.currentStage : firm.lifecycleState;
  if ((raw ?? "").trim() !== "") {
    return normalizeLifecycle(raw);
  }
  if ((firm.disposition ?? "").toLowerCase().includes("reject")) {
    return PASSED;
  }
  return "Discovered";
}

/**
 * "Open" — the funnel stages that still represent undecided work.
 *
 * This is THE definition of open across the product. The desk header used to
 * carry its own lifecycleState test, which counted
 * 674 firms against the funnel's 441 for the same database: a firm that a
 * base rule hard-rejected still reads "Discovered" in its lifecycleState, so
 * the desk called it open while the funnel had already placed it in
 * Passed. Deriving from bucketOf is what keeps the two honest — anything
 * the funnel considers decided is decided everywhere.
 */
export const OPEN_BUCKETS = ["Discovered", "Screening"] as const;

export function isOpenBucket(bucket: Lifecycle): boolean {
  return (OPEN_BUCKETS as readonly Lifecycle[]).includes(bucket);
}

/** Open per the funnel, for a caller holding the hard-reject verdict. */
export function isOpenFirm(firm: BucketFirm, hardRejected: boolean): boolean {
  return isOpenBucket(bucketOfHardRejected(firm, hardRejected));
}

export function emptyBucketCounts(): Record<Lifecycle, number> {
  return Object.fromEntries(LIFECYCLE_BUCKETS.map((b) => [b, 0])) as Record<Lifecycle, number>;
}
