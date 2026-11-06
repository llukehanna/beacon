import { describe, expect, it } from "vitest";
import { MIN_SAMPLE, rateCell, sampleNote } from "./accuracyModel";

describe("rateCell", () => {
  it("prints a dash when nothing stands behind the rate", () => {
    expect(rateCell(null, 0)).toEqual({ text: "—", sparse: false, pct: null });
  });

  it("prints the count when the sample is thin", () => {
    expect(rateCell(100, MIN_SAMPLE - 1)).toEqual({
      text: `n=${MIN_SAMPLE - 1}`,
      sparse: true,
      pct: null,
    });
  });

  it("prints the percentage once the sample is large enough", () => {
    expect(rateCell(96, MIN_SAMPLE)).toEqual({ text: "96%", sparse: false, pct: 96 });
    expect(rateCell(0, 20)).toEqual({ text: "0%", sparse: false, pct: 0 });
  });

  it("prints a dash for a missing rate on a large sample", () => {
    expect(rateCell(null, 20).text).toBe("—");
  });
});

describe("sampleNote", () => {
  it("says how many are decided, or that none are", () => {
    expect(sampleNote(12, 20)).toBe("12 decided of 20 total");
    expect(sampleNote(0, 3)).toBe("3 findings, none decided yet");
  });
});
