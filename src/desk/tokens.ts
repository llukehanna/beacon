/**
 * Beacon JS-only colour maps (tier badges, band chips, confidence chips,
 * finding status). The values follow the palette in src/styles/tokens.css:
 * amber = conflict, green = verified or positive, red = negative or rejected,
 * indigo = proposed. Layout tokens are read from CSS variables (see
 * nocturne.css and tokens.css) via var(--color-*), var(--space-*), etc.
 */
import type { CSSProperties } from "react";
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

// Per-axis 0/1/2 band chip — matches support.js:bandChip().
export const BAND_COLOR: Record<number, { fg: string; bg: string }> = {
  0: { fg: "#f4948b", bg: "rgba(240,113,103,.14)" },
  1: { fg: "#f3c978", bg: "rgba(240,185,85,.14)" },
  2: { fg: "#7fe0b5", bg: "rgba(79,209,154,.14)" },
};

// confidenceTier chip — matches dataProvider.CONFIDENCE.
export const CONFIDENCE_CHIP: Record<string, { label: string; fg: string; bg: string }> = {
  high: { label: "High", fg: "#7fe0b5", bg: "rgba(79,209,154,.16)" },
  low: { label: "Low", fg: "#f5d58f", bg: "rgba(240,185,85,.16)" },
  abstain: { label: "Abstain", fg: "#9ba1ab", bg: "rgba(255,255,255,.05)" },
};

// findingStatus chip — matches dataProvider.FINDING.
export const FINDING_CHIP: Record<string, { label: string; fg: string; bg: string }> = {
  proposed: { label: "Proposed", fg: "#b4bbff", bg: "rgba(138,149,255,.14)" },
  verified: { label: "Verified", fg: "#7fe0b5", bg: "rgba(79,209,154,.14)" },
  abstained: { label: "Abstained", fg: "#9ba1ab", bg: "rgba(255,255,255,.05)" },
  rejected: { label: "Rejected", fg: "#f4948b", bg: "rgba(240,113,103,.14)" },
};

// Provider labels live in shared/vocab (the server's accuracySummary sorts by them).
export { PROVIDER_LABEL, providerLabel } from "../../shared/vocab";

// Body-void background — the page background token (--bg), one step darker
// than the first surface (--color-bg is --s1). Everything inside the desk
// still reads from --color-* variables.
export const VOID_BG = "#07080a";

// Accent-tinted danger for reject buttons — the design uses this color-mix
// for the reject secondary button border.
export const REJECT_BORDER = "color-mix(in srgb, #f07167 42%, transparent)";
export const REJECT_TEXT = "#f4948b";
export const REJECT_ICON = "#f7aaa3";

// Commit-success (green) for the "your call · advance" primary action.
export const SUCCESS_TEXT = "#8ee5c0";
export const SUCCESS_TINT_BG = "rgba(79,209,154,.16)";
export const SUCCESS_TINT_BORDER = "color-mix(in srgb, #4fd19a 30%, transparent)";

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

// The one outcome that reads as a miss for a firm we passed — carries a
// muted red tint on chips and drives the /accuracy headline count.
export const OUTCOME_ACQUIRED = ACQUIRED_BY_COMPETITOR;

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

// The one-clause telling of the divergence story — reused verbatim by the
// Home card so the two surfaces don't drift apart in wording.
export const DIVERGENCE_PHRASE = "we passed, market didn't";

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
    label: `Outcome diverged — ${DIVERGENCE_PHRASE}`,
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
    fg: "color-mix(in srgb, var(--color-text) 62%, transparent)",
    bg: "var(--color-neutral-800)",
    border: "var(--color-divider)",
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
  if (key === OUTCOME_ACQUIRED) {
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
    fg: "color-mix(in srgb, var(--color-text) 68%, transparent)",
    bg: "var(--color-neutral-800)",
    border: "color-mix(in srgb, var(--color-text) 18%, transparent)",
  };
}

/** One sidebar frame for every screen, so the rail is the same width on every route. */
export const SIDEBAR_STYLE: CSSProperties = {
  width: 240,
  flex: "0 0 240px",
  borderRight: "1px solid var(--color-divider)",
  display: "flex",
  flexDirection: "column",
  padding: 16,
  gap: 12,
  minHeight: 0,
};
