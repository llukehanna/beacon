import { describe, expect, it } from "vitest";
import { generateUniverse } from "../seed/universe.js";
import { asFirmObject } from "./pipeline.js";
import { evaluateRuleRecovery, plantRejections } from "./rules.js";

const universe = generateUniverse().map(asFirmObject);

describe("plantRejections", () => {
  it("plants the seed's patterns, each firm rejected once, with the analyst's words", async () => {
    const { rows, planted } = await plantRejections(universe);
    expect(planted.map((p) => p.predicate.axis)).toEqual([
      "employees",
      "coverage_model",
      "deal_size_usd_m",
      "deals_per_md_l3y",
    ]);
    expect(new Set(rows.map((r) => r.firmId)).size).toBe(rows.length);
    const small = planted[0];
    expect(small.decisionIds).toHaveLength(7);
    for (const id of small.decisionIds) {
      expect(rows.find((r) => r.decisionId === id)!.rationale).toMatch(/^Too small/);
    }
  });
});

describe("evaluateRuleRecovery", () => {
  it("recovers the planted patterns with the heuristic clusterer", async () => {
    expect(await evaluateRuleRecovery(universe)).toEqual({
      planted: 4,
      recovered: 4,
      method: "heuristic",
    });
  });

  it("is deterministic", async () => {
    expect(await evaluateRuleRecovery(universe)).toEqual(await evaluateRuleRecovery(universe));
  });

  it("counts nothing as recovered when no rule is proposed", async () => {
    const none = async () => ({ proposals: [], source: "heuristic" as const });
    expect((await evaluateRuleRecovery(universe, none)).recovered).toBe(0);
  });
});
