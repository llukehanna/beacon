import { describe, expect, it } from "vitest";
import { mandateSubtitle, summarizeSync, syncedAgo } from "./status";

describe("summarizeSync", () => {
  it("has no sync time before any response", () => {
    expect(summarizeSync([])).toEqual({ lastSyncedAt: null, unreachable: false });
  });

  it("reports the latest successful fetch across queries", () => {
    const s = summarizeSync([
      { dataUpdatedAt: 1000, errorUpdatedAt: 0 },
      { dataUpdatedAt: 4000, errorUpdatedAt: 0 },
    ]);
    expect(s).toEqual({ lastSyncedAt: 4000, unreachable: false });
  });

  it("is unreachable when a failure is newer than every success", () => {
    const s = summarizeSync([
      { dataUpdatedAt: 4000, errorUpdatedAt: 0 },
      { dataUpdatedAt: 0, errorUpdatedAt: 5000 },
    ]);
    expect(s).toEqual({ lastSyncedAt: 4000, unreachable: true });
  });

  it("recovers once a later fetch succeeds", () => {
    const s = summarizeSync([
      { dataUpdatedAt: 6000, errorUpdatedAt: 0 },
      { dataUpdatedAt: 0, errorUpdatedAt: 5000 },
    ]);
    expect(s.unreachable).toBe(false);
  });
});

describe("syncedAgo", () => {
  it("counts seconds, then minutes, then hours", () => {
    expect(syncedAgo(0)).toBe("0s ago");
    expect(syncedAgo(7400)).toBe("7s ago");
    expect(syncedAgo(59_999)).toBe("59s ago");
    expect(syncedAgo(60_000)).toBe("1m ago");
    expect(syncedAgo(3_600_000)).toBe("1h ago");
  });

  it("never goes negative when the clock is behind the server", () => {
    expect(syncedAgo(-5000)).toBe("0s ago");
  });
});

describe("mandateSubtitle", () => {
  it("shows the scoped mandate when one is selected", () => {
    expect(mandateSubtitle("Mid-market sell-side", 3)).toBe("Mid-market sell-side");
  });

  it("counts active mandates otherwise", () => {
    expect(mandateSubtitle(null, 3)).toBe("3 active mandates");
    expect(mandateSubtitle("  ", 1)).toBe("1 active mandate");
    expect(mandateSubtitle(null, 0)).toBe("No active mandates");
  });

  it("is empty while the count is loading", () => {
    expect(mandateSubtitle(null, undefined)).toBeNull();
  });
});
