/**
 * Synthetic market signals: invented news about a firm (a departure, a hire, a deal, an
 * acquisition) that Beacon applies on a schedule so a decided firm can move on its own. Nothing
 * here is real. Every screen that shows a signal uses SYNTHETIC_LABEL beside it, and the finding a
 * signal writes carries the provider key MARKET_SIGNAL, which the trust figures leave out.
 *
 * Pure: no React, no data access. The server's apply step (server/signals/apply.ts) and the
 * screens read the same kinds, labels and wording.
 */
import { axisLabel } from "./trustMetrics.js";
import { MARKET_SIGNAL } from "./vocab.js";

/** The words that mark a signal as invented, wherever it is shown. */
export const SYNTHETIC_LABEL = "Synthetic market signal";

export { MARKET_SIGNAL };

export const SIGNAL_KINDS = [
  "senior_hire",
  "departure",
  "deal_announcement",
  "acquisition",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

const KIND_LABEL: Readonly<Record<SignalKind, string>> = {
  senior_hire: "Senior hire",
  departure: "Departure",
  deal_announcement: "Deal announcement",
  acquisition: "Acquisition",
};

export function isSignalKind(kind: string | null | undefined): kind is SignalKind {
  return (SIGNAL_KINDS as readonly string[]).includes(kind ?? "");
}

/** "Senior hire", "Departure", ...; an unknown kind reads as written. */
export function kindLabel(kind: string | null | undefined): string {
  return isSignalKind(kind) ? KIND_LABEL[kind] : (kind ?? "").trim() || "Signal";
}

/** The ResearchFinding axes a signal can move, by kind. Acquisition moves no rubric axis. */
export const SIGNAL_AXES: Readonly<Record<SignalKind, readonly string[]>> = {
  senior_hire: ["fee_generating_count"],
  departure: ["fee_generating_count"],
  deal_announcement: ["deal_size_usd_m", "deals_per_md_l3y"],
  acquisition: [],
};

/** The MarketSignal properties the screens read; every one may be missing. */
export interface SignalLike {
  signalId?: string | null;
  firmId?: string | null;
  kind?: string | null;
  effectiveDate?: unknown;
  headline?: string | null;
  axis?: string | null;
  newValue?: string | null;
  appliedAt?: unknown;
  effect?: string | null;
}

const nonEmpty = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/** What an applied signal did: it changed something, or it was applied and changed nothing. */
export const EFFECT_MOVED = "moved";
export const EFFECT_UNCHANGED = "unchanged";

/** A signal that has been applied: its effects are in the firm's score and findings. */
export const isApplied = (s: SignalLike): boolean =>
  s.appliedAt !== null && s.appliedAt !== undefined && s.appliedAt !== "";

/**
 * What the signal changed, in words: the axis and the value it moved to, or the market outcome an
 * acquisition records.
 */
export function axisMovedText(s: SignalLike): string {
  if (s.effect === EFFECT_UNCHANGED) {
    return "No change";
  }
  if (s.kind === "acquisition") {
    return "Market outcome: acquired by a competitor";
  }
  const axis = nonEmpty(s.axis);
  const value = nonEmpty(s.newValue);
  if (axis === null || value === null) {
    return "No score axis moved";
  }
  const shown = axis === "deal_size_usd_m" ? `$${value}m` : value;
  return `${axisLabel(axis)} → ${shown}`;
}
