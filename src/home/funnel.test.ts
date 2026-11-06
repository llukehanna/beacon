import { describe, expect, it } from "vitest";
import { funnelBars } from "./funnel";

const STAGES = ["Discovered", "Screening", "Qualified"] as const;

describe("funnelBars", () => {
  it("gives the largest stage the full height", () => {
    const bars = funnelBars({ Discovered: 531, Screening: 265, Qualified: 100 }, STAGES);
    expect(bars[0]).toEqual({ stage: "Discovered", count: 531, px: 56 });
    expect(bars[1].px).toBe(28);
  });

  it("never drops a stage with firms below the minimum height", () => {
    const bars = funnelBars({ Discovered: 531, Screening: 1, Qualified: 0 }, STAGES);
    expect(bars[1].px).toBe(6);
  });

  it("gives an empty stage no bar", () => {
    const bars = funnelBars({ Discovered: 531, Screening: 1, Qualified: 0 }, STAGES);
    expect(bars[2]).toEqual({ stage: "Qualified", count: 0, px: 0 });
  });

  it("keeps the order of the stages it is given", () => {
    const bars = funnelBars({ Discovered: 1, Screening: 9, Qualified: 4 }, [
      "Qualified",
      "Discovered",
      "Screening",
    ]);
    expect(bars.map((b) => b.stage)).toEqual(["Qualified", "Discovered", "Screening"]);
  });

  it("treats a missing stage as zero and an all-zero funnel as flat", () => {
    expect(funnelBars({}, STAGES).map((b) => b.px)).toEqual([0, 0, 0]);
  });

  it("honours custom bounds", () => {
    const bars = funnelBars({ Discovered: 10, Screening: 1 }, ["Discovered", "Screening"], 4, 20);
    expect(bars.map((b) => b.px)).toEqual([20, 4]);
  });
});
