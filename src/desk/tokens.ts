/**
 * Beacon JS-only colour maps (tier badges, band chips, confidence chips,
 * finding status). The values follow the palette in src/styles/tokens.css:
 * amber = conflict, green = verified or positive, red = negative or rejected,
 * indigo = proposed. Layout tokens live in CSS (src/styles/tokens.css).
 */
import { ACQUIRED_BY_COMPETITOR } from "../../shared/vocab";

// Tier palette — matches dataProvider.tierFromScore output.
export const TIER_COLOR: Record<string, string> = {
  A: "#4fd19a",
  B: "#f0b955",
  C: "#f07167",
  Rejected: "#7d838e",
};

// Tier labels — note "Rejected" here means "weighted score below C" (a
// soft state that enrichment can move). "Hard-rejected" is a separate
// display state reserved for firms actually screened out (base rule or
// active approved HardScreenConfig row); it's decided at the render
// site, not looked up here, so a low-score firm doesn't accidentally
// read as "hard-rejected" when the screen never fired.
export const TIER_LABEL: Record<string, string> = {
  A: "Strong fit",
  B: "Moderate fit",
  C: "Weak fit",
  Rejected: "Rejected",
};

// Provider labels live in shared/vocab (the server's accuracySummary sorts by them).
export { PROVIDER_LABEL, providerLabel } from "../../shared/vocab";

// ─── Observed outcome (post-decision) ───────────────────────────────────
// Firm.outcome is backfilled by the FDE against decided firms; null on
// firms not yet observed. Rendered as a chip on the desk header, the
// pipeline detail rail, and aggregated on /accuracy. Vocabulary is the
// backend's snake_case; the labels are the display strings.

export const OUTCOME_LABEL: Record<string, string> = {
  converted_to_talks: "Converted to talks",
  loi: "LOI",
  closed: "Closed",
  went_cold: "Went cold",
  acquired_by_competitor: "Acquired by competitor",
};

export function outcomeLabel(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return "Not yet observed";
  }
  const key = raw.trim().toLowerCase();
  if (key === "") {
    return "Not yet observed";
  }
  return OUTCOME_LABEL[key] ?? raw;
}

// ─── Drift trigger vocabulary ───────────────────────────────────────────
// Three triggers today, each with a distinct visual anchor so the analyst
// can scan the review queue and read "why did this surface?" at a glance
// without opening the card:
//   tier_moved              → red     (score dropped past a tier boundary)
//   pass_reason_invalidated → amber   (an axis behind the pass changed)
//   outcome_diverged        → violet  (we passed, market didn't)
// Colors deliberately don't overlap the amber/red pair — a fourth trigger
// would need its own hue rather than reusing one of the existing three.
// Shared by /review and the Home "needs you" card so the violet reads as
// one vocabulary across both surfaces.

export interface DriftReasonStyle {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

// The divergence violet, named so non-chip surfaces (Home's preview line,
// the outcome tile on the trust panel) can reach for the same values.
export const DIVERGENCE_FG = "#c9a9f7";
export const DIVERGENCE_BG = "rgba(155,127,224,.16)";
export const DIVERGENCE_BORDER = "color-mix(in srgb, #9b7fe0 40%, transparent)";

export const DRIFT_REASON_STYLE: Record<string, DriftReasonStyle> = {
  tier_moved: {
    label: "Tier moved",
    fg: "#f4948b",
    bg: "rgba(240,113,103,.14)",
    border: "color-mix(in srgb, #f07167 32%, transparent)",
  },
  pass_reason_invalidated: {
    label: "Pass reason invalidated",
    fg: "#f3c978",
    bg: "rgba(240,185,85,.14)",
    border: "color-mix(in srgb, #f0b955 32%, transparent)",
  },
  outcome_diverged: {
    label: "Outcome diverged — we passed, market didn't",
    fg: DIVERGENCE_FG,
    bg: DIVERGENCE_BG,
    border: DIVERGENCE_BORDER,
  },
};

export function driftReasonPresentation(raw: string | undefined): DriftReasonStyle {
  const key = (raw ?? "").toLowerCase();
  if (DRIFT_REASON_STYLE[key]) {
    return DRIFT_REASON_STYLE[key];
  }
  return {
    label: raw ?? "unknown reason",
    fg: "var(--tx2)",
    bg: "var(--s3)",
    border: "var(--line2)",
  };
}

export function isOutcomeDivergence(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "outcome_diverged";
}

export function outcomeChipStyle(raw: string | null | undefined): {
  fg: string;
  bg: string;
  border: string;
} {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === ACQUIRED_BY_COMPETITOR) {
    // Divergence violet — a firm we passed that the market bought IS the
    // outcome_diverged story, just observed on the firm rather than in the
    // review queue. Same hue on both surfaces so the thread is legible.
    // Red stays reserved for rejection.
    return {
      fg: DIVERGENCE_FG,
      bg: DIVERGENCE_BG,
      border: DIVERGENCE_BORDER,
    };
  }
  return {
    fg: "var(--tx2)",
    bg: "var(--s3)",
    border: "var(--line2)",
  };
}
