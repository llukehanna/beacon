import { describe, expect, it } from "vitest";
import { firmDecisions } from "./firmDecisions";

describe("firmDecisions", () => {
  const rows = [
    {
      decisionId: "a",
      decisionType: "qualify",
      decidedAt: "2026-03-01T10:00:00Z",
      scoreAtDecision: 18,
    },
    {
      decisionId: "b",
      decisionType: "reject",
      decidedAt: "2026-04-01T10:00:00Z",
      rejectionRationale: "  Outside the mandate  ",
    },
    { decisionId: "c", decisionType: "hard_reject", decidedAt: "not a date" },
  ];

  it("lists the newest decision first and drops one with no readable time", () => {
    expect(firmDecisions(rows).map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("words the decision and carries its rationale and score", () => {
    const [passed, qualified] = firmDecisions(rows);
    expect(passed).toMatchObject({
      label: "Passed",
      rejected: true,
      rationale: "Outside the mandate",
      score: null,
    });
    expect(qualified).toMatchObject({
      label: "Qualified",
      rejected: false,
      rationale: null,
      score: 18,
    });
  });

  it("makes words of a type the vocabulary does not know", () => {
    const [d] = firmDecisions([{ decisionType: "site_visit", decidedAt: "2026-01-01T00:00:00Z" }]);
    expect(d.label).toBe("Site visit");
  });
});
