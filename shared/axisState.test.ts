import { describe, expect, it } from "vitest";
import {
  type FindingLike,
  axisBadge,
  classifyAxis,
  isSignalFinding,
  isVerifiedFinding,
  needsYouAxisCountByFirm,
  pickAuthoritative,
  signalOutranksCheck,
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

  const mine = (over: Partial<FindingLike> = {}) =>
    f("mine", {
      provider: "analyst",
      findingStatus: "verified",
      verifiedByHuman: true,
      verifiedAt: "2026-01-01T00:00:00Z",
      retrievedAt: "2026-01-01T00:00:00Z",
      ...over,
    });

  it("outranks a human check that is older than it, so the value shown is the value scored", () => {
    // The signal is dated 2026-06-01; the analyst's check was in January.
    const auth = pickAuthoritative([mine(), signal("s")]);
    expect(auth.findingId).toBe("s");
    expect(classifyAxis(auth)).toBe("signal");
    // Even over an agent finding the analyst verified long ago (recorded then, verified then).
    const agent = f("agent", {
      findingStatus: "verified",
      verifiedByHuman: true,
      retrievedAt: "2026-01-01T00:00:00Z",
      verifiedAt: "2026-02-01T00:00:00Z",
    });
    expect(pickAuthoritative([agent, signal("s")]).findingId).toBe("s");
  });

  it("is outranked by a human check made after it", () => {
    const later = mine({ verifiedAt: "2026-07-01T00:00:00Z", retrievedAt: "2026-07-01T00:00:00Z" });
    const auth = pickAuthoritative([signal("s"), later]);
    expect(auth.findingId).toBe("mine");
    expect(classifyAxis(auth)).toBe("verified");
    // A verification of an older agent finding counts from when it was verified, not recorded.
    const verifiedLater = f("v", {
      findingStatus: "verified",
      verifiedByHuman: true,
      retrievedAt: "2026-01-01T00:00:00Z",
      verifiedAt: "2026-07-01T00:00:00Z",
    });
    expect(pickAuthoritative([signal("s"), verifiedLater]).findingId).toBe("v");
  });

  it("follows the newest signal when there are several", () => {
    const newer = signal("s2", { retrievedAt: "2026-06-10T00:00:00Z" });
    expect(pickAuthoritative([mine(), signal("s1"), newer]).findingId).toBe("s2");
  });

  it("agrees with the apply step's rule at the boundary: a tie goes to the news", () => {
    const t = Date.parse("2026-06-01T00:00:00Z");
    expect(signalOutranksCheck(t, null)).toBe(true);
    expect(signalOutranksCheck(t, t - 1)).toBe(true);
    expect(signalOutranksCheck(t, t)).toBe(true);
    expect(signalOutranksCheck(t, t + 1)).toBe(false);
    expect(
      pickAuthoritative([mine({ verifiedAt: "2026-06-01T00:00:00Z" }), signal("s")]).findingId,
    ).toBe("s");
  });

  it("leaves an open proposal ahead of a signal while nothing is verified, and behind it once the news is newer than a check", () => {
    expect(pickAuthoritative([f("p"), signal("s")]).findingId).toBe("p");
    expect(
      pickAuthoritative([f("p", { retrievedAt: "2026-07-01T00:00:00Z" }), mine(), signal("s")])
        .findingId,
    ).toBe("s");
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
