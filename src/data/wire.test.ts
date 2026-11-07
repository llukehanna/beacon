import { describe, expect, it } from "vitest";
import { linkQueryReads, normalizeError, toLinkMap } from "./wire";

describe("toLinkMap", () => {
  it("builds a Map keyed by source primary key", () => {
    const m = toLinkMap({ s1: [{ $apiName: "Firm", $primaryKey: "f1" }] });
    expect(m.get("s1")?.[0].$primaryKey).toBe("f1");
    expect(toLinkMap(undefined).size).toBe(0);
  });
});

describe("normalizeError", () => {
  it("reports 'no error' as undefined, like the OSDK hooks did", () => {
    expect(normalizeError(null)).toBeUndefined();
    const e = new Error("boom");
    expect(normalizeError(e)).toBe(e);
  });
});

describe("linkQueryReads", () => {
  const key = ["links", "SearchList", "firms", ["L1"]];
  it("is stale when either end of the link changed", () => {
    expect(linkQueryReads(key, new Set(["Firm"]))).toBe(true);
    expect(linkQueryReads(key, new Set(["SearchList"]))).toBe(true);
  });
  it("is fresh when the action touched neither end", () => {
    expect(linkQueryReads(key, new Set(["ReviewDecision", "ProposedRule"]))).toBe(false);
  });
  it("refetches a link it does not recognise", () => {
    expect(linkQueryReads(["links", "Nope", "x", []], new Set(["Firm"]))).toBe(true);
    expect(linkQueryReads(["links"], new Set(["Firm"]))).toBe(true);
  });
});
