import { describe, expect, it } from "vitest";
import { confidenceBarCount } from "./confidence";
import { visibleTrend } from "./metricTrend";
import { monogram } from "./monogram";

describe("monogram", () => {
  it("uses the first letters of the first two words", () => {
    expect(monogram("Bellhaven Talbot Group")).toBe("BT");
  });

  it("skips a leading 'the'", () => {
    expect(monogram("The Corrivale Partners")).toBe("CP");
  });

  it("uses the first two letters of a single word", () => {
    expect(monogram("Ambercroft")).toBe("AM");
  });

  it("skips '&' and 'and'", () => {
    expect(monogram("Smith & Co")).toBe("SC");
    expect(monogram("Smith and Co")).toBe("SC");
  });

  it("returns an empty string for a blank name", () => {
    expect(monogram("   ")).toBe("");
  });
});

describe("confidenceBarCount", () => {
  it("fills three bars for high, one for low and none for unknown", () => {
    expect(confidenceBarCount("high")).toBe(3);
    expect(confidenceBarCount("low")).toBe(1);
    expect(confidenceBarCount(null)).toBe(0);
  });
});

describe("visibleTrend", () => {
  it("passes a varying series and its delta through", () => {
    expect(visibleTrend({ points: [60, 70, 80, 90], delta: 30 })).toEqual({
      points: [60, 70, 80, 90],
      delta: 30,
    });
  });

  it("hides the line and the delta of a flat series", () => {
    expect(visibleTrend({ points: [100, 100, 100, 100], delta: 0 })).toEqual({
      points: null,
      delta: null,
    });
    expect(visibleTrend({ points: [100, 100, 100, 100], delta: 2 }).delta).toBeNull();
  });

  it("hides a delta of zero but keeps the line", () => {
    expect(visibleTrend({ points: [80, 90, 70, 80], delta: 0 })).toEqual({
      points: [80, 90, 70, 80],
      delta: null,
    });
  });

  it("shows nothing without a trend", () => {
    expect(visibleTrend(null)).toEqual({ points: null, delta: null });
    expect(visibleTrend(undefined)).toEqual({ points: null, delta: null });
    expect(visibleTrend({ points: [50], delta: null })).toEqual({ points: null, delta: null });
  });
});
