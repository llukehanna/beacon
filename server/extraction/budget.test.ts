import { describe, expect, it } from "vitest";
import { assignCustomIds, planChunks, selectFirmsToExtract, withRetry } from "./budget.js";
import { EXTRACTION_PROMPT_VERSION, SYSTEM_PROMPT } from "./contract.js";
import type { FixtureRecord } from "./fixtures.js";
import {
  PRICES,
  costFromUsage,
  estimateFirmCostUsd,
  hasPrice,
  systemPromptCaches,
} from "./pricing.js";

const MODEL = "claude-haiku-4-5";

const rec = (firmId: string, overrides: Partial<FixtureRecord> = {}): FixtureRecord => ({
  firmId,
  model: MODEL,
  promptVersion: EXTRACTION_PROMPT_VERSION,
  documentsHash: `hash-${firmId}`,
  createdAt: "2026-11-04T00:00:00.000Z",
  output: { items: [] },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0,
  latencyMs: null,
  batchId: null,
  ...overrides,
});

describe("selectFirmsToExtract", () => {
  const ids = ["c", "a", "d", "b"];
  const hashes = new Map(ids.map((id) => [id, `hash-${id}`]));

  it("resumes: skips firms with a current record and re-selects stale ones", () => {
    const existing = [
      rec("a"),
      rec("b", { documentsHash: "old" }), // template edited since
      rec("c", { promptVersion: "extract-v0" }),
      rec("d", { model: "claude-sonnet-5-5" }), // another model's file
    ];
    expect(selectFirmsToExtract(ids, existing, { model: MODEL, hashes })).toEqual(["b", "c", "d"]);
  });

  it("sorts by firmId, then takes the first sample", () => {
    expect(selectFirmsToExtract(ids, [], { model: MODEL, hashes, sample: 2 })).toEqual(["a", "b"]);
    expect(selectFirmsToExtract(ids, [rec("a")], { model: MODEL, hashes, sample: 2 })).toEqual([
      "b",
      "c",
    ]);
  });

  it("keeps a firm whose last reply was unusable as done", () => {
    expect(
      selectFirmsToExtract(["a"], [rec("a", { output: null })], { model: MODEL, hashes }),
    ).toEqual([]);
  });
});

describe("planChunks", () => {
  const firms = Array.from({ length: 20 }, (_, i) => `f${i}`);

  it("never plans past the cap", () => {
    const { chunks, skippedForBudget } = planChunks(firms, () => 0.01, 1, 0.95, 10);
    expect(chunks.flat()).toHaveLength(5);
    expect(chunks.flat()).toEqual(firms.slice(0, 5));
    expect(skippedForBudget).toBe(15);
  });

  it("plans nothing when the next firm does not fit", () => {
    expect(planChunks(firms, () => 0.01, 1, 0.995, 10)).toEqual({
      chunks: [],
      skippedForBudget: 20,
    });
  });

  it("cuts the plan into chunks of the given size", () => {
    const { chunks, skippedForBudget } = planChunks(firms, () => 0.001, 5, 0, 8);
    expect(chunks.map((c) => c.length)).toEqual([8, 8, 4]);
    expect(skippedForBudget).toBe(0);
  });
});

describe("assignCustomIds", () => {
  it("keeps valid ids and maps the rest to unique stand-ins", () => {
    const long = "x".repeat(65);
    const ids = assignCustomIds(["ok_firm-1", "has space", long, "f0"]);
    expect(ids.get("ok_firm-1")).toBe("ok_firm-1");
    expect(ids.get("f0")).toBe("f0");
    const standIns = [...ids].filter(([, firmId]) => firmId === "has space" || firmId === long);
    expect(standIns).toHaveLength(2);
    for (const [customId] of standIns) {
      expect(customId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
    expect(new Set(ids.keys()).size).toBe(4);
    expect(assignCustomIds(["ok_firm-1", "has space", long, "f0"])).toEqual(ids);
  });
});

describe("pricing", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  };

  it("costFromUsage applies the batch discount", () => {
    const p = PRICES[MODEL];
    const full = p.inputPerMTok + p.outputPerMTok + p.cacheReadPerMTok + p.cacheWritePerMTok;
    expect(costFromUsage(MODEL, usage, false)).toBeCloseTo(full, 10);
    expect(costFromUsage(MODEL, usage, true)).toBeCloseTo(full / 2, 10);
  });

  it("looks prices up by own key only", () => {
    expect(hasPrice(MODEL)).toBe(true);
    expect(hasPrice("constructor")).toBe(false);
    expect(hasPrice("__proto__")).toBe(false);
    expect(() => costFromUsage("constructor", usage, true)).toThrow(/No price/);
    expect(() => estimateFirmCostUsd("__proto__", 100, 100, true)).toThrow(/No price/);
  });

  it("does not assume Sonnet caches a short prompt", () => {
    expect(systemPromptCaches("claude-sonnet-5-5", SYSTEM_PROMPT.length)).toBe(false);
  });

  it("throws for a model with no price", () => {
    expect(() => costFromUsage("claude-unknown", usage, true)).toThrow(/No price/);
  });

  it("does not credit a cache read to a system prompt below the model's minimum", () => {
    // The real prompt is far below Haiku 4.5's 4096-token minimum.
    expect(systemPromptCaches(MODEL, SYSTEM_PROMPT.length)).toBe(false);
    const short = estimateFirmCostUsd(MODEL, 8000, 3000, false);
    const p = PRICES[MODEL];
    expect(short).toBeCloseTo(
      (2000 * p.inputPerMTok + 750 * p.inputPerMTok + 600 * p.outputPerMTok) / 1e6,
      10,
    );
    // A prompt past the minimum is priced as a cache read.
    const long = estimateFirmCostUsd(MODEL, 8000, 20_000, false);
    expect(long).toBeCloseTo(
      (2000 * p.inputPerMTok + 5000 * p.cacheReadPerMTok + 600 * p.outputPerMTok) / 1e6,
      10,
    );
    expect(estimateFirmCostUsd(MODEL, 8000, 3000, true)).toBeCloseTo(short / 2, 10);
  });
});

describe("planChunks hardening", () => {
  const firms = Array.from({ length: 12 }, (_, i) => `f${i}`);

  it("sizes the first chunk separately", () => {
    const { chunks } = planChunks(firms, () => 0.001, 5, 0, 5, 2);
    expect(chunks.map((c) => c.length)).toEqual([2, 5, 5]);
  });

  it("plans from worst-case output: a bigger ceiling plans fewer firms", () => {
    const estimate = (outputTokens: number) => (id: string) =>
      estimateFirmCostUsd(MODEL, id.length * 1000, 3000, true, outputTokens);
    const typical = planChunks(firms, estimate(600), 0.01, 0, 100).skippedForBudget;
    const worst = planChunks(firms, estimate(1500), 0.01, 0, 100).skippedForBudget;
    expect(worst).toBeGreaterThan(typical);
    // The worst-case plan really fits: its estimates sum to no more than the cap.
    const planned = firms.slice(0, firms.length - worst);
    expect(planned.reduce((sum, id) => sum + estimate(1500)(id), 0)).toBeLessThanOrEqual(0.01);
  });

  it("throws on an estimate that is not a finite number", () => {
    expect(() => planChunks(firms, () => Number.NaN, 5, 0, 5)).toThrow(/not a usable number/);
    expect(() => planChunks(firms, () => Infinity, 5, 0, 5)).toThrow(/not a usable number/);
    expect(() => planChunks(firms, () => -1, 5, 0, 5)).toThrow(/not a usable number/);
  });
});

describe("withRetry", () => {
  const transient = (e: unknown) => e instanceof Error && e.message === "blip";

  it("retries transient errors with doubling backoff, then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withRetry(
      async () => {
        if (++calls < 4) {
          throw new Error("blip");
        }
        return "ok";
      },
      { isTransient: transient, sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("tries 5 times by default, then throws the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("blip");
        },
        { isTransient: transient, sleep: async () => {} },
      ),
    ).rejects.toThrow("blip");
    expect(calls).toBe(5);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("bad request");
        },
        { isTransient: transient, sleep: async () => {} },
      ),
    ).rejects.toThrow("bad request");
    expect(calls).toBe(1);
  });
});
