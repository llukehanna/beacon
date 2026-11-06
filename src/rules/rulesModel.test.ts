import { describe, expect, it } from "vitest";
import {
  type ConfigLike,
  type RuleLike,
  currentVersion,
  displayDecider,
  effectivePredicate,
  groupRules,
  groupVersions,
  parseSupportingIds,
  truncatePredicateAtWord,
  versionHistory,
} from "./rulesModel";

const config = (over: Partial<ConfigLike>): ConfigLike => ({
  configRuleId: "c",
  sourceProposedRuleId: "r1",
  configAxis: "employees",
  configOperator: "<",
  configThreshold: "10",
  configVersion: 1,
  configActive: true,
  ...over,
});

describe("displayDecider", () => {
  it("keeps a name and turns an id or blank into you", () => {
    expect(displayDecider("demo-analyst")).toBe("demo-analyst");
    expect(displayDecider("e7496a93-1b2c-4d3e-8f90-a1b2c3d4e5f6")).toBe("you");
    expect(displayDecider("  ")).toBe("you");
    expect(displayDecider(undefined)).toBe("you");
  });
});

describe("truncatePredicateAtWord", () => {
  it("leaves a short predicate alone", () => {
    expect(truncatePredicateAtWord("employees < 10", 48)).toBe("employees < 10");
  });

  it("cuts at the last separator instead of mid-word", () => {
    expect(truncatePredicateAtWord('geographic_footprint == "Pan-European"', 28)).toBe(
      "geographic_footprint ==…",
    );
  });
});

describe("parseSupportingIds", () => {
  it("reads a JSON array, a comma list and nothing", () => {
    expect(parseSupportingIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseSupportingIds("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(parseSupportingIds(undefined)).toEqual([]);
    expect(parseSupportingIds("")).toEqual([]);
  });
});

describe("groupVersions", () => {
  it("orders by version and picks the latest active row", () => {
    const m = groupVersions([
      config({ configRuleId: "b", configVersion: 2, configThreshold: "12" }),
      config({ configRuleId: "a", configVersion: 1, configActive: false }),
      config({ configRuleId: "x", sourceProposedRuleId: undefined }),
    ]);
    const v = m.get("r1");
    expect(v?.all.map((c) => c.configVersion)).toEqual([1, 2]);
    expect(v?.activeLatest?.configRuleId).toBe("b");
    expect(m.size).toBe(1);
  });

  it("has no active row once every version is inactive", () => {
    const v = groupVersions([config({ configActive: false })]).get("r1");
    expect(v?.activeLatest).toBeNull();
    expect(currentVersion(v!)).toBe(1);
  });
});

describe("effectivePredicate and versionHistory", () => {
  const rule: RuleLike = {
    proposedRuleId: "r1",
    predicateAxis: "employees",
    ruleOperator: "<",
    ruleThreshold: "10",
  };

  it("prefers the active config over the proposal", () => {
    const v = groupVersions([config({ configVersion: 2, configThreshold: "12" })]).get("r1")!;
    expect(effectivePredicate(rule, v)).toBe("employees < 12");
  });

  it("falls back to the proposal and is null when it is incomplete", () => {
    expect(effectivePredicate(rule, { all: [], activeLatest: null })).toBe("employees < 10");
    expect(
      effectivePredicate({ proposedRuleId: "r2" }, { all: [], activeLatest: null }),
    ).toBeNull();
  });

  it("lists each version's predicate oldest first", () => {
    const v = groupVersions([
      config({ configVersion: 2, configThreshold: "12" }),
      config({ configVersion: 1, configActive: false }),
    ]).get("r1")!;
    expect(versionHistory(v)).toBe("v1: employees < 10 → v2: employees < 12");
  });
});

describe("groupRules", () => {
  it("splits by status and treats a missing status as pending", () => {
    const g = groupRules([
      { proposedRuleId: "a" },
      { proposedRuleId: "b", ruleStatus: "Approved" },
      { proposedRuleId: "c", ruleStatus: "dismissed" },
      { proposedRuleId: "d", ruleStatus: "weird" },
    ]);
    expect(g.pending.map((r) => r.proposedRuleId)).toEqual(["a"]);
    expect(g.approved.map((r) => r.proposedRuleId)).toEqual(["b"]);
    expect(g.declined.map((r) => r.proposedRuleId)).toEqual(["c", "d"]);
  });
});
