import { describe, expect, it } from "vitest";
import { P95_MIN_RUNS, percentiles, summarizeRuns, usd, windowLabel } from "./operations.js";

describe("percentiles", () => {
  it("is null when nothing was measured", () => {
    expect(percentiles([])).toBeNull();
  });

  it("takes the nearest-rank value, so each figure was actually measured", () => {
    expect(percentiles([42])).toEqual({ p50: 42, p95: 42 });
    expect(percentiles([10, 20, 30, 40])).toEqual({ p50: 20, p95: 40 });
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentiles(hundred)).toEqual({ p50: 50, p95: 95 });
  });

  it("returns the slowest run as p95 until there are P95_MIN_RUNS runs", () => {
    const upTo = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 10);
    expect(percentiles(upTo(P95_MIN_RUNS - 1))!.p95).toBe((P95_MIN_RUNS - 1) * 10);
    expect(percentiles(upTo(P95_MIN_RUNS))!.p95).toBe((P95_MIN_RUNS - 1) * 10);
  });

  it("does not depend on input order and leaves the input alone", () => {
    const input = [30, 10, 40, 20];
    expect(percentiles(input)).toEqual({ p50: 20, p95: 40 });
    expect(input).toEqual([30, 10, 40, 20]);
  });
});

describe("summarizeRuns", () => {
  it("groups by action with count, errors and latency, busiest first", () => {
    const runs = [
      { actionName: "rejectFirm", durationMs: 30, ok: true },
      { actionName: "qualifyFirm", durationMs: 10, ok: true },
      { actionName: "rejectFirm", durationMs: 50, ok: false },
      { actionName: "rejectFirm", durationMs: 40, ok: true },
    ];
    expect(summarizeRuns(runs)).toEqual([
      { actionName: "rejectFirm", count: 3, errors: 1, p50Ms: 40, p95Ms: 50 },
      { actionName: "qualifyFirm", count: 1, errors: 0, p50Ms: 10, p95Ms: 10 },
    ]);
    expect(summarizeRuns([])).toEqual([]);
  });
});

describe("windowLabel", () => {
  it("names the last reset in UTC", () => {
    expect(windowLabel("2026-11-06T04:00:12.345Z")).toBe(
      "since the last reset at 2026-11-06 04:00 UTC",
    );
  });

  it("says so when no reset was recorded or the time is unreadable", () => {
    expect(windowLabel(null)).toBe("since this database was set up (no reset recorded)");
    expect(windowLabel("yesterday")).toBe("since this database was set up (no reset recorded)");
  });
});

describe("usd", () => {
  it("keeps sub-dollar spend to four places", () => {
    expect(usd(0.0123456)).toBe("$0.0123");
    expect(usd(0)).toBe("$0.0000");
    expect(usd(12.5)).toBe("$12.50");
  });
});
