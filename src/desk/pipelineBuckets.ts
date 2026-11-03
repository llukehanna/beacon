/**
 * Pipeline lifecycle vocabulary — the eight-stage funnel plus the Passed outcome.
 *
 * The bucket derivation lives in shared/pipelineBuckets (the server's
 * homeSummary uses it too); this module re-exports it and adds the status
 * chip palette, which is UI-only.
 */
import { type Lifecycle } from "../../shared/pipelineBuckets";

export * from "../../shared/pipelineBuckets";

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
