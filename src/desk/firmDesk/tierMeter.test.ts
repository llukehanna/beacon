import { describe, expect, it } from "vitest";
import { MAX_POSSIBLE, type Model, TIER_THRESHOLDS, tierFor } from "../scoreMirror";
import { tierMeter } from "./tierMeter";

const CUTS = TIER_THRESHOLDS.CF;

describe("tierMeter", () => {
  it("covers 0 to 1 with contiguous segments, lowest tier first", () => {
    const { segments } = tierMeter(14, MAX_POSSIBLE, CUTS);
    expect(segments.map((s) => s.tier)).toEqual(["Rejected", "C", "B", "A"]);
    expect(segments[0].from).toBe(0);
    expect(segments[segments.length - 1].to).toBe(1);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].from).toBe(segments[i - 1].to);
    }
  });

  it("sizes the segments from the thresholds", () => {
    const { segments } = tierMeter(0, MAX_POSSIBLE, CUTS);
    expect(segments[1].from).toBeCloseTo(CUTS.C / MAX_POSSIBLE);
    expect(segments[2].from).toBeCloseTo(CUTS.B / MAX_POSSIBLE);
    expect(segments[3].from).toBeCloseTo(CUTS.A / MAX_POSSIBLE);
  });

  it("puts the pin at the score's share of the maximum", () => {
    expect(tierMeter(14, 18, CUTS).pin).toBeCloseTo(14 / 18);
  });

  it("clamps a score above the maximum, or below zero, into the bar", () => {
    expect(tierMeter(25, 18, CUTS).pin).toBe(1);
    expect(tierMeter(-3, 18, CUTS).pin).toBe(0);
  });

  it("has no ghost when there is no prior score or it equals the score", () => {
    expect(tierMeter(14, 18, CUTS).ghost).toBeNull();
    expect(tierMeter(14, 18, CUTS, null).ghost).toBeNull();
    expect(tierMeter(14, 18, CUTS, 14).ghost).toBeNull();
  });

  it("puts the ghost at the prior score's share of the maximum", () => {
    expect(tierMeter(14, 18, CUTS, 11).ghost).toBeCloseTo(11 / 18);
  });

  it("returns the tier the rubric gives every score", () => {
    for (const model of Object.keys(TIER_THRESHOLDS) as Model[]) {
      for (let score = 0; score <= MAX_POSSIBLE; score++) {
        expect(tierMeter(score, MAX_POSSIBLE, TIER_THRESHOLDS[model]).tier).toBe(
          tierFor(score, model),
        );
      }
    }
  });
});
