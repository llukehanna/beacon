import { describe, expect, it } from "vitest";
import {
  SIGNAL_AXES,
  SIGNAL_KINDS,
  SYNTHETIC_LABEL,
  axisMovedText,
  isApplied,
  isSignalKind,
  kindLabel,
} from "./marketSignals.js";
import { providerLabel } from "./vocab.js";

describe("market signal wording", () => {
  it("labels every kind, and an unknown one as written", () => {
    expect(SIGNAL_KINDS.map(kindLabel)).toEqual([
      "Senior hire",
      "Departure",
      "Deal announcement",
      "Acquisition",
    ]);
    expect(kindLabel("rumour")).toBe("rumour");
    expect(kindLabel(null)).toBe("Signal");
    expect(isSignalKind("departure")).toBe(true);
    expect(isSignalKind("rumour")).toBe(false);
  });

  it("says what a signal moved", () => {
    expect(axisMovedText({ kind: "departure", axis: "fee_generating_count", newValue: "3" })).toBe(
      "Fee-earning heads → 3",
    );
    expect(
      axisMovedText({ kind: "deal_announcement", axis: "deal_size_usd_m", newValue: "180" }),
    ).toBe("Avg deal size → $180m");
    expect(axisMovedText({ kind: "acquisition" })).toBe("Market outcome: acquired by a competitor");
    expect(axisMovedText({ kind: "departure" })).toBe("No score axis moved");
    expect(
      axisMovedText({
        kind: "departure",
        axis: "fee_generating_count",
        newValue: "3",
        effect: "unchanged",
      }),
    ).toBe("No change");
  });

  it("knows an applied signal by its appliedAt", () => {
    expect(isApplied({ appliedAt: "2026-11-01T00:00:00Z" })).toBe(true);
    expect(isApplied({})).toBe(false);
    expect(isApplied({ appliedAt: null })).toBe(false);
  });

  it("names the provider of its findings with the synthetic label", () => {
    expect(providerLabel("market_signal")).toBe(SYNTHETIC_LABEL);
    expect(SYNTHETIC_LABEL).toBe("Synthetic market signal");
  });

  it("moves only the axes the rubric scores", () => {
    expect(SIGNAL_AXES.acquisition).toEqual([]);
    expect(SIGNAL_AXES.departure).toEqual(SIGNAL_AXES.senior_hire);
  });
});
