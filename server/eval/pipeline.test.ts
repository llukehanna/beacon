import { describe, expect, it } from "vitest";
import { EXTRACTION_PROMPT_VERSION } from "../extraction/contract.js";
import { documentsHash, firmDocuments } from "../extraction/documents.js";
import type { FixtureRecord } from "../extraction/fixtures.js";
import { generateUniverse } from "../seed/universe.js";
import { asFirmObject, evaluateFirms, extractionRowsFromFixtures } from "./pipeline.js";

const sample = generateUniverse(30).map(asFirmObject);

describe("evaluateFirms", () => {
  it("is deterministic", () => {
    expect(evaluateFirms(sample, [])).toEqual(evaluateFirms(sample, []));
  });

  it("evaluates every axis the firm's model enriches, against its hidden truth", () => {
    const evals = evaluateFirms(sample, []);
    expect(evals).toHaveLength(sample.length);
    for (const e of evals) {
      expect(e.slots.length).toBe(e.model === "CS" ? 11 : 10);
      expect(e.extractionModel).toBe("rule-based");
      for (const s of e.slots) {
        expect(s.truth).not.toBe("");
        // Abstain, settle on one value, or surface exactly two conflicting positions.
        expect([1, 2]).toContain(s.plans.length);
        // Every kept reading was stated by that provider's own record.
        for (const k of s.kept) {
          expect(s.stated).toContain(k.provider);
        }
      }
    }
  });
});

describe("extractionRowsFromFixtures", () => {
  const firm = sample[0];
  const docs = firmDocuments(firm);
  const record = (value: string, over: Partial<FixtureRecord> = {}): FixtureRecord => ({
    firmId: firm.$primaryKey,
    model: "test-model",
    promptVersion: EXTRACTION_PROMPT_VERSION,
    documentsHash: documentsHash(docs),
    createdAt: "2026-01-01T00:00:00.000Z",
    output: {
      items: [
        {
          provider: "dealdb",
          axis: "firm_age",
          value,
          quote: `The firm has been operating for ${value} years.`,
        },
      ],
    },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0,
    latencyMs: null,
    batchId: null,
    ...over,
  });

  it("drops a record made against other document text", () => {
    expect(
      extractionRowsFromFixtures([record("12", { documentsHash: "00000000" })], sample),
    ).toEqual([]);
  });

  it("keeps one row per firm, model, provider and axis; a later record replaces an earlier one", () => {
    const rows = extractionRowsFromFixtures([record("12"), record("13")], sample);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("13");
    expect(rows[0].$primaryKey).toBe(rows[0].extractionId);
  });
});
