/**
 * The Signals section of the Review page as plain data: the market signals that have already been
 * applied, newest first, each with the firm it names and what it moved. Pure: no React, no data
 * access. A signal that has not come due yet is not news, so it is left out.
 */
import {
  SYNTHETIC_LABEL,
  type SignalLike,
  axisMovedText,
  isApplied,
  kindLabel,
} from "../../shared/marketSignals";
import { relativeAge, toIsoTime } from "../home/age";

export interface SignalRowModel {
  id: string;
  headline: string;
  firmId: string;
  firmName: string;
  /** "Departure", "Senior hire", ... */
  kind: string;
  /** Time since it took effect ("3d"); null when none was recorded. */
  age: string | null;
  /** The day it took effect, yyyy-mm-dd in UTC; empty when none was recorded. */
  date: string;
  /** What it moved: "Fee-earning heads → 3". */
  moved: string;
  /** Always "Synthetic market signal". */
  label: string;
}

export interface SignalsView {
  rows: SignalRowModel[];
  /** Applied signals in all, of which `rows` shows the newest. */
  total: number;
}

const effectiveMs = (s: SignalLike): number => {
  const iso = toIsoTime(s.effectiveDate);
  return iso === null ? 0 : Date.parse(iso);
};

/** The newest `limit` applied signals, with firm names from `firms`. */
export function buildSignalsView(
  signals: readonly SignalLike[],
  firms: ReadonlyArray<{ firmId?: string; firmName?: string | null }>,
  now: number,
  limit = 8,
): SignalsView {
  const names = new Map(firms.map((f) => [f.firmId ?? "", f.firmName ?? ""]));
  const applied = signals
    .filter(isApplied)
    .sort(
      (a, b) =>
        effectiveMs(b) - effectiveMs(a) || (b.signalId ?? "").localeCompare(a.signalId ?? ""),
    );
  return {
    total: applied.length,
    rows: applied.slice(0, limit).map((s) => {
      const firmId = s.firmId ?? "";
      const iso = toIsoTime(s.effectiveDate);
      return {
        id: s.signalId ?? "",
        headline: (s.headline ?? "").trim() || "No headline",
        firmId,
        firmName: names.get(firmId) || firmId || "Unknown firm",
        kind: kindLabel(s.kind),
        age: relativeAge(iso, now),
        date: iso === null ? "" : iso.slice(0, 10),
        moved: axisMovedText(s),
        label: SYNTHETIC_LABEL,
      };
    }),
  };
}
