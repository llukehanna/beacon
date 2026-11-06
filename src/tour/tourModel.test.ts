import { describe, expect, it } from "vitest";
import { nextStep, prevStep, resolveAnchor, stepFromSearch, stepSearch } from "./tourModel";
import { TOUR_STEPS } from "./tourSteps";

describe("tour steps", () => {
  it("TOUR_STEPS has 6 steps with unique ids", () => {
    expect(TOUR_STEPS).toHaveLength(6);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(6);
  });

  it("visits the routes in order", () => {
    expect(TOUR_STEPS.map((s) => s.route)).toEqual([
      "/mandate",
      "/desk",
      "/desk",
      "/desk",
      "/rules",
      "/review",
    ]);
  });
});

describe("stepFromSearch", () => {
  it("reads ?tour= as a zero-based index", () => {
    expect(stepFromSearch("?tour=3")).toBe(2);
    expect(stepFromSearch("?tour=1")).toBe(0);
    expect(stepFromSearch("?firmId=x&tour=6")).toBe(5);
  });

  it("is null when absent or invalid", () => {
    expect(stepFromSearch("?tour=9")).toBeNull();
    expect(stepFromSearch("?tour=0")).toBeNull();
    expect(stepFromSearch("?tour=abc")).toBeNull();
    expect(stepFromSearch("?tour=2.5")).toBeNull();
    expect(stepFromSearch("")).toBeNull();
    expect(stepFromSearch("?firmId=x")).toBeNull();
  });
});

describe("stepSearch", () => {
  it("sets tour (one-based) and keeps other params", () => {
    expect(stepSearch("", 0)).toBe("?tour=1");
    expect(stepSearch("?firmId=f1", 2)).toBe("?firmId=f1&tour=3");
    expect(stepSearch("?tour=2&firmId=f1", 3)).toBe("?tour=4&firmId=f1");
  });

  it("removes tour when asked for null", () => {
    expect(stepSearch("?tour=2&firmId=f1", null)).toBe("?firmId=f1");
    expect(stepSearch("?tour=2", null)).toBe("");
  });
});

describe("step movement", () => {
  it("nextStep is null after the last", () => {
    expect(nextStep(0)).toBe(1);
    expect(nextStep(4)).toBe(5);
    expect(nextStep(5)).toBeNull();
  });

  it("prevStep is null before the first", () => {
    expect(prevStep(5)).toBe(4);
    expect(prevStep(1)).toBe(0);
    expect(prevStep(0)).toBeNull();
  });
});

/** A document stub: `querySelector` answers only the data-tour selectors the tour asks for. */
function fakeDoc(anchors: Record<string, Element>): Document {
  return {
    querySelector: (selector: string): Element | null => {
      const m = /^\[data-tour="([^"]+)"\]$/.exec(selector);
      return m === null ? null : (anchors[m[1]] ?? null);
    },
  } as unknown as Document;
}

describe("resolveAnchor", () => {
  const step = TOUR_STEPS[1];
  const el = { id: "hit" } as unknown as Element;

  it("finds the element carrying the step's anchor", () => {
    expect(resolveAnchor(fakeDoc({ [step.anchor as string]: el }), step)).toBe(el);
  });

  it("falls back when the anchor is absent", () => {
    expect(resolveAnchor(fakeDoc({ other: el }), step)).toBeNull();
  });

  it("is null for a step with no anchor", () => {
    expect(resolveAnchor(fakeDoc({}), { ...step, anchor: null })).toBeNull();
  });
});
