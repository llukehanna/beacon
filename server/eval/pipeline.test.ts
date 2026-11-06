import { describe, expect, it } from "vitest";
import { generateUniverse } from "../seed/universe.js";
import { asFirmObject, evaluateFirms } from "./pipeline.js";

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
