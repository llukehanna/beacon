import { describe, expect, it } from "vitest";
import { headlineText } from "./headlineText";

const counts = (enrichedFirms: number, abstainedAxes: number) => ({
  enrichedFirms,
  abstainedAxes,
  windowHours: 24 as const,
});

describe("headlineText", () => {
  it("states what needs you, then what the agent's latest runs did", () => {
    expect(headlineText(43, counts(26, 39))).toEqual({
      lead: "43 items need you.",
      detail:
        "The agent's latest runs enriched 26 firms and declined to guess on 39 axes that are still open.",
    });
  });

  it("agrees in number", () => {
    expect(headlineText(1, counts(1, 1))).toEqual({
      lead: "1 item needs you.",
      detail:
        "The agent's latest runs enriched 1 firm and declined to guess on 1 axis that is still open.",
    });
  });

  it("says so when nothing needs you or nothing is open", () => {
    expect(headlineText(0, counts(3, 0))).toEqual({
      lead: "Nothing needs you.",
      detail: "The agent's latest runs enriched 3 firms and left no axis open.",
    });
  });

  it("leaves out the agent sentence when no firm has been enriched", () => {
    expect(headlineText(5, null)).toEqual({ lead: "5 items need you.", detail: null });
  });
});
