import { describe, expect, it } from "vitest";
import { scoreHistory } from "./scoreHistory";

describe("scoreHistory", () => {
  it("lists newest first with the change from the score before", () => {
    const history = scoreHistory([
      { scoreId: "b", weightedTotal: 9, computedAt: "2026-11-02T10:00:00Z" },
      { scoreId: "a", weightedTotal: 6, computedAt: "2026-11-01T10:00:00Z" },
      { scoreId: "c", weightedTotal: 8, computedAt: "2026-11-03T10:00:00Z" },
    ]);
    expect(history.map((h) => [h.id, h.total, h.change])).toEqual([
      ["c", 8, -1],
      ["b", 9, 3],
      ["a", 6, null],
    ]);
  });

  it("drops rows with no readable time or total", () => {
    expect(
      scoreHistory([
        { scoreId: "x", weightedTotal: null, computedAt: "2026-11-01T10:00:00Z" },
        { scoreId: "y", weightedTotal: 5, computedAt: "not a date" },
      ]),
    ).toEqual([]);
  });
});
