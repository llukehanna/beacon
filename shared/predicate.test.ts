import { describe, expect, it } from "vitest";
import {
  matchesPredicate,
  predicateField,
  rubricGateFor,
  ruleKey,
  rulePatternKey,
} from "./predicate.js";

describe("matchesPredicate", () => {
  const firm = { firmType: "CF", employees: 6, coverageModel: "Generalist", geoScore: 1 };

  it("compares numerically when both sides are numbers", () => {
    expect(matchesPredicate(firm, { axis: "employees", operator: "<", threshold: "10" })).toBe(
      true,
    );
    expect(matchesPredicate(firm, { axis: "employees", operator: ">=", threshold: "10" })).toBe(
      false,
    );
    expect(matchesPredicate(firm, { axis: "geo_score", operator: "<", threshold: "2" })).toBe(true);
  });

  it("compares strings case-insensitively for == and !=", () => {
    expect(
      matchesPredicate(firm, { axis: "coverage_model", operator: "==", threshold: "generalist" }),
    ).toBe(true);
    expect(
      matchesPredicate(firm, { axis: "coverage_model", operator: "!=", threshold: "Generalist" }),
    ).toBe(false);
  });

  it("never screens a firm that is missing the value", () => {
    expect(
      matchesPredicate({ firmType: "CF" }, { axis: "employees", operator: "<", threshold: "10" }),
    ).toBe(false);
  });

  it("respects the rule's model scope", () => {
    const p = { axis: "employees", operator: "<", threshold: "10" };
    expect(matchesPredicate(firm, { ...p, model: "CS" })).toBe(false);
    expect(matchesPredicate(firm, { ...p, model: "both" })).toBe(true);
  });

  it("rejects unknown axes and operators", () => {
    expect(predicateField("vibes")).toBeNull();
    expect(matchesPredicate(firm, { axis: "employees", operator: "~", threshold: "10" })).toBe(
      false,
    );
  });

  it("builds a stable identity key", () => {
    expect(ruleKey("employees", "<", " 10 ", "Both")).toBe("employees|<|10|both");
  });
});

describe("rulePatternKey", () => {
  it("ignores threshold and model, case and spaces", () => {
    expect(rulePatternKey(" Deal_Size_USD_m ", "<")).toBe(rulePatternKey("deal_size_usd_m", "< "));
    expect(rulePatternKey("deal_size_usd_m", "<")).not.toBe(
      rulePatternKey("deal_size_usd_m", "<="),
    );
  });
});

describe("rubricGateFor", () => {
  it("names the rubric's hard-reject an equality repeats", () => {
    const generalist = { axis: "coverage_model", operator: "==", threshold: "Generalist" };
    expect(rubricGateFor({ ...generalist, model: "CF" })).toMatch(/Generalist coverage model/);
    expect(rubricGateFor({ ...generalist, model: "both" })).toMatch(/Generalist coverage model/);
    // The CS rubric does not reject on coverage.
    expect(rubricGateFor({ ...generalist, model: "CS" })).toBeNull();
  });

  it("finds nothing in thresholds and other values", () => {
    expect(rubricGateFor({ axis: "employees", operator: "<", threshold: "10" })).toBeNull();
    expect(
      rubricGateFor({ axis: "coverage_model", operator: "==", threshold: "Multi-sector" }),
    ).toBeNull();
    expect(
      rubricGateFor({ axis: "coverage_model", operator: "!=", threshold: "Generalist" }),
    ).toBeNull();
  });
});
