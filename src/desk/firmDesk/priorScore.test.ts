import { describe, expect, it } from "vitest";
import { enrichmentDelta, priorScoreBefore } from "./priorScore";

const row = (computedAt: string, weightedTotal: number) => ({ computedAt, weightedTotal });

describe("priorScoreBefore", () => {
  const rows = [
    row("2026-11-05T09:00:00.000Z", 9),
    row("2026-11-05T10:00:00.000Z", 11),
    row("2026-11-05T12:00:00.000Z", 14),
  ];

  it("takes the latest row computed before the enrichment", () => {
    expect(priorScoreBefore(rows, "2026-11-05T11:00:00.000Z")).toBe(11);
  });

  it("ignores a row computed at the enrichment's own instant", () => {
    expect(priorScoreBefore(rows, "2026-11-05T12:00:00.000Z")).toBe(11);
  });

  it("is null when the firm was never enriched or has no earlier row", () => {
    expect(priorScoreBefore(rows, null)).toBeNull();
    expect(priorScoreBefore(rows, "2026-11-05T08:00:00.000Z")).toBeNull();
    expect(priorScoreBefore([], "2026-11-05T11:00:00.000Z")).toBeNull();
  });

  it("skips rows with no usable time or total", () => {
    expect(
      priorScoreBefore(
        [
          { computedAt: "nope", weightedTotal: 5 },
          { computedAt: "2026-11-05T09:00:00.000Z" },
          ...rows,
        ],
        "2026-11-05T11:00:00.000Z",
      ),
    ).toBe(11);
  });
});

describe("enrichmentDelta", () => {
  it("is the stored total less the earlier one", () => {
    expect(enrichmentDelta(9, 6, false)).toBe(3);
    expect(enrichmentDelta(5, 6, false)).toBe(-1);
  });

  it("is zero with no earlier score", () => {
    expect(enrichmentDelta(9, null, false)).toBe(0);
  });

  it("is zero for a hard-rejected firm, whose total of zero is not a change", () => {
    expect(enrichmentDelta(0, 8, true)).toBe(0);
  });
});
