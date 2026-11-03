import { describe, expect, it } from "vitest";
import { LIFECYCLE_STAGES, PASSED, nextLifecycle, normalizeLifecycle } from "./vocab.js";

describe("nextLifecycle", () => {
  it("steps through the funnel one stage at a time", () => {
    expect(LIFECYCLE_STAGES).toEqual([
      "Discovered",
      "Screening",
      "Qualified",
      "Outreach",
      "NDA",
      "IOI",
      "LOI",
      "Closed",
    ]);
    LIFECYCLE_STAGES.slice(0, -1).forEach((stage, i) => {
      expect(nextLifecycle(stage)).toBe(LIFECYCLE_STAGES[i + 1]);
    });
  });

  it("has no next stage after Closed or for Passed", () => {
    expect(nextLifecycle("Closed")).toBeNull();
    expect(nextLifecycle(PASSED)).toBeNull();
  });
});

describe("normalizeLifecycle", () => {
  it("maps the legacy vocabulary onto the funnel", () => {
    expect(normalizeLifecycle("In Review")).toBe("Screening");
    expect(normalizeLifecycle("In Talks")).toBe("Outreach");
    expect(normalizeLifecycle("Rejected")).toBe("Passed");
  });

  it("passes current values through, tolerating case and separators", () => {
    for (const stage of [...LIFECYCLE_STAGES, PASSED]) {
      expect(normalizeLifecycle(stage)).toBe(stage);
    }
    expect(normalizeLifecycle("in_review")).toBe("Screening");
    expect(normalizeLifecycle("In-Talks")).toBe("Outreach");
    expect(normalizeLifecycle("OUTREACH")).toBe("Outreach");
  });

  it("falls back to Discovered for null, empty and unknown values", () => {
    expect(normalizeLifecycle(null)).toBe("Discovered");
    expect(normalizeLifecycle(undefined)).toBe("Discovered");
    expect(normalizeLifecycle("")).toBe("Discovered");
    expect(normalizeLifecycle("Somewhere else")).toBe("Discovered");
  });
});
