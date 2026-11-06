import { describe, expect, it } from "vitest";
import { dailyRateTrend, findingTrends, groundedCounts } from "./trends.js";

/** `n` events on a UTC day, the first `hits` of them hits. */
function day(date: string, n: number, hits: number) {
  return Array.from({ length: n }, (_, i) => ({
    at: `${date}T${String(i % 24).padStart(2, "0")}:15:00.000Z`,
    hit: i < hits,
  }));
}

const f = (i: number, patch: Record<string, unknown>) => ({
  findingId: `f${i}`,
  confidenceTier: "high",
  findingStatus: "proposed",
  provider: "dealdb",
  ...patch,
});

describe("dailyRateTrend", () => {
  it("returns null below minBuckets", () => {
    const events = [
      ...day("2026-11-01", 10, 5),
      ...day("2026-11-02", 10, 6),
      ...day("2026-11-03", 10, 7),
    ];
    expect(dailyRateTrend(events)).toBeNull();
  });

  it("buckets by UTC day", () => {
    const events = [
      { at: "2026-11-01T23:30:00.000Z", hit: true },
      { at: "2026-11-02T00:30:00.000Z", hit: false },
    ];
    const trend = dailyRateTrend(events, { minBuckets: 2, minPerBucket: 1 });
    expect(trend?.points).toEqual([
      { day: "2026-11-01", value: 100, n: 1 },
      { day: "2026-11-02", value: 0, n: 1 },
    ]);
    expect(trend?.delta).toBe(-100);
  });

  it("drops thin buckets", () => {
    const events = [
      ...day("2026-11-01", 10, 5),
      ...day("2026-11-02", 4, 4), // below the default 5
      ...day("2026-11-03", 10, 6),
      ...day("2026-11-04", 10, 7),
    ];
    expect(dailyRateTrend(events)).toBeNull(); // only 3 days survive
    const trend = dailyRateTrend([...events, ...day("2026-11-05", 10, 8)]);
    expect(trend?.points.map((p) => p.day)).toEqual([
      "2026-11-01",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
  });

  it("computes rate and delta", () => {
    const events = [
      ...day("2026-11-04", 10, 8), // out of order on purpose
      ...day("2026-11-01", 10, 5),
      ...day("2026-11-02", 10, 6),
      ...day("2026-11-03", 10, 7),
    ];
    const trend = dailyRateTrend(events);
    expect(trend?.points.map((p) => p.value)).toEqual([50, 60, 70, 80]);
    expect(trend?.delta).toBe(30);
  });

  it("ignores events with an unreadable timestamp", () => {
    const events = [...day("2026-11-01", 5, 5), { at: "not a date", hit: false }];
    expect(dailyRateTrend(events, { minBuckets: 1 })?.points).toEqual([
      { day: "2026-11-01", value: 100, n: 5 },
    ]);
  });
});

describe("findingTrends", () => {
  const one = { minBuckets: 1, minPerBucket: 1 };

  it("measures grounding over source-backed values only", () => {
    const findings = [
      f(1, { retrievedAt: "2026-11-01T10:00:00Z", sourceQuote: "a quote" }),
      f(2, { retrievedAt: "2026-11-01T10:00:00Z", sourceQuote: "" }),
      f(3, { retrievedAt: "2026-11-01T10:00:00Z", confidenceTier: "abstain" }),
      f(4, { retrievedAt: "2026-11-01T10:00:00Z", provider: "analyst" }),
    ];
    const t = findingTrends(findings, one);
    expect(t.grounded?.points).toEqual([{ day: "2026-11-01", value: 50, n: 2 }]);
    expect(t.abstention?.points).toEqual([{ day: "2026-11-01", value: 25, n: 4 }]);
    expect(t.agreement).toBeNull();
  });

  it("measures agreement over decided findings by verifiedAt", () => {
    const findings = [
      f(1, {
        verifiedByHuman: true,
        findingStatus: "verified",
        verifiedAt: "2026-11-02T09:00:00Z",
      }),
      f(2, { findingStatus: "rejected", verifiedAt: "2026-11-02T09:30:00Z" }),
      f(3, { verifiedAt: "2026-11-02T09:45:00Z" }), // pending: not decided
    ];
    expect(findingTrends(findings, one).agreement?.points).toEqual([
      { day: "2026-11-02", value: 50, n: 2 },
    ]);
  });
});

describe("groundedCounts", () => {
  it("counts source-backed agent values and how many carry a quote", () => {
    const findings = [
      f(1, { sourceQuote: "a quote" }),
      f(2, { sourceQuote: "  " }),
      f(3, { sourceQuote: "another" }),
      f(4, { confidenceTier: "abstain" }),
      f(5, { provider: "analyst", sourceQuote: "typed in" }),
    ];
    expect(groundedCounts(findings)).toEqual({ cited: 2, agentValues: 3 });
  });

  it("is zero over no findings", () => {
    expect(groundedCounts([])).toEqual({ cited: 0, agentValues: 0 });
  });
});
