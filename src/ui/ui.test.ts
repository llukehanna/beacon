import { describe, expect, it } from "vitest";
import { confidenceBarCount } from "./confidence";
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
