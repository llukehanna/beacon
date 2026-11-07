import { describe, expect, it } from "vitest";
import {
  matchesPredicate,
  overlappingPatternKeys,
  predicateField,
  rubricGateFor,
  ruleKey,
  rulePatternKey,
} from "./predicate.js";
import { describePredicate } from "./rulePredicate.js";

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
  it("ignores case and spaces, and reads an empty model as both", () => {
    expect(rulePatternKey(" Deal_Size_USD_m ", "<")).toBe(rulePatternKey("deal_size_usd_m", "< "));
    expect(rulePatternKey("deal_size_usd_m", "<", "")).toBe(
      rulePatternKey("deal_size_usd_m", "<", "Both"),
    );
    expect(rulePatternKey("deal_size_usd_m", "<")).not.toBe(
      rulePatternKey("deal_size_usd_m", "<="),
    );
  });

  it("keeps the models apart, so a CS-only rule is not a CF-only rule", () => {
    const cf = rulePatternKey("deal_size_usd_m", "<", "CF");
    const cs = rulePatternKey("deal_size_usd_m", "<", "CS");
    expect(cf).not.toBe(cs);
    expect(cf).not.toBe(rulePatternKey("deal_size_usd_m", "<", "both"));
  });
});

describe("overlappingPatternKeys", () => {
  const keys = (model: string) => overlappingPatternKeys("deal_size_usd_m", "<", model);
  const key = (model: string) => rulePatternKey("deal_size_usd_m", "<", model);

  it("lets CF and CS stay distinct and both overlap either", () => {
    expect(keys("CF")).not.toContain(key("CS"));
    expect(keys("CS")).not.toContain(key("CF"));
    expect(keys("CF")).toContain(key("both"));
    expect(keys("CS")).toContain(key("both"));
    expect(keys("both")).toEqual(expect.arrayContaining([key("CF"), key("CS"), key("both")]));
    expect(keys("")).toEqual(keys("both"));
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

describe("describePredicate", () => {
  it("says a predicate in the shared axis words, with plain operators and the deal size unit", () => {
    expect(describePredicate("deal_size_usd_m", "<", "20")).toBe("Avg deal size below $20m");
    expect(describePredicate("employees", ">=", "10")).toBe("Headcount at least 10");
    expect(describePredicate("coverage_model", "==", "Generalist Focus")).toBe(
      "Sector coverage is Generalist Focus",
    );
    expect(describePredicate("firm_age", "!=", "3")).toBe("Firm age is not 3");
  });

  it("never shows the machine names", () => {
    const said = describePredicate("deals_per_md_l3y", "<=", "2");
    expect(said).toBe("Deals per MD (last 3 years) at most 2");
    expect(said).not.toMatch(/_|<|>|=/);
    expect(describePredicate("", "<", "1")).toBe("a rule with no condition");
  });
});
