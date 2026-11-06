import { describe, expect, it } from "vitest";
import {
  type FindingLike,
  axisBadge,
  classifyAxis,
  isSignalFinding,
  isVerifiedFinding,
  needsYouAxisCountByFirm,
  pickAuthoritative,
} from "./axisState.js";

const f = (findingId: string, over: Partial<FindingLike> = {}): FindingLike => ({
  findingId,
  axis: "fee_generating_count",
  provider: "dealdb",
  findingStatus: "proposed",
  retrievedAt: "2026-05-01T00:00:00Z",
  ...over,
});
const signal = (id: string, over: Partial<FindingLike> = {}) =>
  f(id, {
    provider: "market_signal",
    findingStatus: "signal",
    retrievedAt: "2026-06-01T00:00:00Z",
    ...over,
  });

describe("a market signal's finding on the desk", () => {
  it("is never verified, whatever flags it carries", () => {
    expect(isSignalFinding(signal("s"))).toBe(true);
    expect(isVerifiedFinding(signal("s"))).toBe(false);
    expect(
      isVerifiedFinding(signal("s", { findingStatus: "verified", verifiedByHuman: true })),
    ).toBe(false);
  });

  it("has its own state, with a label that says it is synthetic and shows no confidence", () => {
    expect(classifyAxis(signal("s"))).toBe("signal");
    expect(axisBadge("signal", true)).toEqual({
      label: "Synthetic market signal",
      showProvider: false,
      showConfidence: false,
    });
  });

  it("speaks for an axis only when nothing else has been found for it", () => {
    expect(pickAuthoritative([signal("s")]).findingId).toBe("s");
    // A newer signal does not displace an open proposal, which is still work for the analyst.
    expect(pickAuthoritative([f("p"), signal("s")]).findingId).toBe("p");
  });

  it("is outranked by a human-verified finding, whichever is newer", () => {
    const mine = f("mine", {
      provider: "analyst",
      findingStatus: "verified",
      verifiedByHuman: true,
      retrievedAt: "2026-01-01T00:00:00Z",
    });
    expect(pickAuthoritative([signal("s"), mine]).findingId).toBe("mine");
    expect(classifyAxis(pickAuthoritative([signal("s"), mine]))).toBe("verified");
  });

  it("never takes an axis off the analyst's list: an abstention it follows still needs them", () => {
    const abstained = f("a", { findingStatus: "abstained", confidenceTier: "abstain" });
    const counts = needsYouAxisCountByFirm([
      { ...abstained, firmId: "x" },
      { ...signal("s"), firmId: "x" },
    ]);
    expect(counts.get("x")).toBe(1);
  });
});
