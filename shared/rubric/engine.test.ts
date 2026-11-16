import { describe, expect, it } from "vitest";
import { TOY } from "./__fixtures__/toyRubric.js";
import { RubricError, parseRubricDefinition } from "./definition.js";
import { criterionPoints, maxPossible, resolveThesis, scoreTraits } from "./engine.js";
import { thesisOf, traitsOf } from "./firm.js";
import type { RubricDefinition } from "./types.js";

const FULL = { product_quality: "Great", team_size: 10, region_fit: 3 };
const growth = (traits: Record<string, string | number | boolean>) =>
  scoreTraits(TOY, "growth", traits);
const clone = (): RubricDefinition => JSON.parse(JSON.stringify(TOY)) as RubricDefinition;

describe("parseRubricDefinition", () => {
  it("accepts the toy rubric", () => {
    expect(parseRubricDefinition(clone())).toEqual(TOY);
  });

  it("rejects an undeclared defaultThesis", () => {
    const d = { ...clone(), defaultThesis: "nope" };
    expect(() => parseRubricDefinition(d)).toThrow(RubricError);
  });

  it("rejects a duplicate criterion within a thesis", () => {
    const d = clone();
    d.theses[0].criteria.push(d.theses[0].criteria[0]);
    expect(() => parseRubricDefinition(d)).toThrow(/product_quality/);
  });

  it("rejects tiers that are not A >= B >= C", () => {
    const d = clone();
    d.theses[0].tiers = { A: 5, B: 6, C: 1 };
    expect(() => parseRubricDefinition(d)).toThrow(RubricError);
  });

  it("rejects a non-positive weight", () => {
    const d = clone();
    d.theses[0].criteria[0].weight = 0;
    expect(() => parseRubricDefinition(d)).toThrow(RubricError);
  });

  it("rejects duplicate thesis keys", () => {
    const d = clone();
    d.theses[1].key = "growth";
    expect(() => parseRubricDefinition(d)).toThrow(RubricError);
  });
});

describe("scoreTraits", () => {
  it("scores a fully known firm against the rubric's own maximum", () => {
    expect(maxPossible(TOY.theses[0])).toBe(11);
    const r = growth(FULL);
    expect(r).toMatchObject({
      model: "growth",
      hardRejected: false,
      weightedTotal: 11,
      maxPossible: 11,
      pct: 1,
      tier: "A",
      action: "Outreach",
      confidence: 1,
    });
    expect(r.axisScores.map((a) => a.axis)).toEqual(["Product", "Team", "Region"]);
  });

  it("multiplies a criterion's points by its weight", () => {
    const r = growth({ product_quality: "OK" });
    expect([r.weightedTotal, r.tier, r.action]).toEqual([3, "C", "Follow"]);
    expect(r.confidence).toBeCloseTo(1 / 3);
  });

  it("honors band edges on a non-monotonic band criterion", () => {
    const team = (n: number) => growth({ team_size: n }).axisScores[1];
    expect(team(4.99)).toEqual({ axis: "Team", score: 0, band: "<5", known: true });
    expect(team(5).score).toBe(2);
    expect(team(20).score).toBe(2);
    expect(team(21)).toEqual({ axis: "Team", score: 1, band: ">20", known: true });
  });

  it("clamps a direct criterion and labels it by trait", () => {
    const region = (n: number) => growth({ region_fit: n }).axisScores[2];
    expect(region(7)).toEqual({ axis: "Region", score: 3, band: "region_fit=3", known: true });
    expect(region(-1).score).toBe(0);
  });

  it("hard-rejects on a yes/no trait that is true, in declared order", () => {
    expect(growth({ ...FULL, sanctioned: true, product_quality: "Toxic" })).toEqual({
      model: "growth",
      hardRejected: true,
      rejectReason: "Sanctioned entity",
      weightedTotal: 0,
      maxPossible: 11,
      pct: 0,
      tier: "Rejected",
      action: "Reject",
      confidence: 1,
      axisScores: [],
    });
    expect(growth({ ...FULL, sanctioned: false }).hardRejected).toBe(false);
    expect(growth(FULL).hardRejected).toBe(false);
  });

  it("matches category hard rejects trimmed and case-insensitively", () => {
    expect(growth({ ...FULL, product_quality: "  TOXIC " }).rejectReason).toBe("Toxic product");
  });

  it("treats a value outside the thesis's options as unknown", () => {
    expect(growth({ product_quality: "Superb" }).axisScores[0]).toEqual({
      axis: "Product",
      score: 0,
      band: "Unknown",
      known: false,
    });
    // Valid under growth, not under value.
    expect(scoreTraits(TOY, "value", { product_quality: "Poor" }).axisScores[0].known).toBe(false);
  });

  it("matches category options trimmed and case-insensitively, keeping the raw band", () => {
    expect(growth({ product_quality: " great " }).axisScores[0]).toEqual({
      axis: "Product",
      score: 2,
      band: " great ",
      known: true,
    });
  });

  it("falls back to the default thesis for a missing or undeclared thesis", () => {
    expect(resolveThesis(TOY, null).key).toBe("growth");
    expect(resolveThesis(TOY, "nope").key).toBe("growth");
    expect(resolveThesis(TOY, " GROWTH ").key).toBe("growth");
    expect(resolveThesis(TOY, " value ").key).toBe("value");
    expect(scoreTraits(TOY, undefined, FULL).model).toBe("growth");
  });

  it("applies an action upgrade at or above its point floor", () => {
    const at8 = growth({ product_quality: "Great", team_size: 10 });
    const at7 = growth({ product_quality: "Great", team_size: 25 });
    expect([at8.weightedTotal, at8.tier, at8.action]).toEqual([8, "B", "Outreach"]);
    expect([at7.weightedTotal, at7.tier, at7.action]).toEqual([7, "B", "Follow"]);
  });

  it("rejects to the bottom tier below C", () => {
    const r = growth({ team_size: 1 });
    expect([r.tier, r.action]).toEqual(["Rejected", "Enrich"]);
  });
});

describe("criterionPoints", () => {
  it("returns a value's unweighted points in isolation", () => {
    expect(criterionPoints(TOY, "growth", "product_quality", "Great")).toBe(2);
    expect(criterionPoints(TOY, "growth", "team_size", 30)).toBe(1);
  });

  it("returns null for a trait the thesis does not score, or a null value", () => {
    expect(criterionPoints(TOY, "growth", "sanctioned", true)).toBeNull();
    expect(criterionPoints(TOY, "value", "team_size", 10)).toBeNull();
    expect(criterionPoints(TOY, "growth", "team_size", null)).toBeNull();
  });

  it("returns null for an unrecognized value and 0 for a disqualifying one", () => {
    expect(criterionPoints(TOY, "growth", "product_quality", "Superb")).toBeNull();
    expect(criterionPoints(TOY, "growth", "product_quality", "Toxic")).toBe(0);
  });
});

describe("firm accessors", () => {
  it("reads the derived traits map, defaulting to empty", () => {
    expect(traitsOf({ traits: { a: 1 } })).toEqual({ a: 1 });
    expect(traitsOf({})).toEqual({});
  });

  it("reads thesis, falling back to the legacy firmType column", () => {
    expect(thesisOf({ thesis: "CS", firmType: "CF" })).toBe("CS");
    expect(thesisOf({ firmType: "CF" })).toBe("CF");
    expect(thesisOf({})).toBeNull();
  });
});
