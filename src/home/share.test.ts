import { describe, expect, it } from "vitest";
import { sharePercent } from "./share";

describe("sharePercent", () => {
  it("rounds to a whole percent", () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(67);
  });

  it("reads 100 only when nothing is missing", () => {
    expect(sharePercent(5430, 5430)).toBe(100);
    expect(sharePercent(5429, 5430)).toBe(99);
  });

  it("is zero with nothing to measure", () => {
    expect(sharePercent(0, 0)).toBe(0);
  });
});
