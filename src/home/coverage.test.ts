import { describe, expect, it } from "vitest";
import { coverageParts } from "./coverage";

describe("coverageParts", () => {
  it("accounts for every firm: open, in progress and passed add up to the total", () => {
    const parts = coverageParts({
      Discovered: 500,
      Screening: 86,
      Qualified: 5,
      Outreach: 2,
      NDA: 1,
      Passed: 106,
    });
    expect(parts).toEqual({ total: 700, open: 586, inProgress: 8, passed: 106 });
    expect(parts.open + parts.inProgress + parts.passed).toBe(parts.total);
  });

  it("treats a missing stage as empty", () => {
    expect(coverageParts({ Discovered: 3 })).toEqual({
      total: 3,
      open: 3,
      inProgress: 0,
      passed: 0,
    });
  });
});
