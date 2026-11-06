import { describe, expect, it } from "vitest";
import { usd } from "../../shared/operations.js";
import { costFromUsage } from "./pricing.js";

describe("claude-opus-5 pricing", () => {
  it("prices 3,465 input and 1,117 output tokens at $0.0452", () => {
    // 3,465 in at $5 and 1,117 out at $25 per million tokens: $0.017325 + $0.027925 = $0.04525.
    const cost = costFromUsage(
      "claude-opus-5",
      { inputTokens: 3465, outputTokens: 1117, cacheReadTokens: 0, cacheWriteTokens: 0 },
      false,
    );
    expect(cost).toBeCloseTo(0.04525, 10);
    expect(Number(cost.toFixed(4))).toBe(0.0452);
    expect(usd(cost)).toBe("$0.0452");
  });
});
