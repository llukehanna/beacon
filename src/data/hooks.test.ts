import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateAfterAction } from "./hooks";

const KEYS = {
  firms: ["objects", "Firm", null, null, null],
  decisions: ["objects", "ReviewDecision", null, null, null],
  searchListFirms: ["links", "SearchList", "firms", ["L1"]],
  searchFirms: ["links", "Search", "firms", ["S1"]],
  home: ["functions", "homeSummary", {}],
} as const;

function cache(): QueryClient {
  const qc = new QueryClient();
  for (const key of Object.values(KEYS)) {
    qc.setQueryData(key, "cached");
  }
  return qc;
}

const stale = (qc: QueryClient) =>
  Object.entries(KEYS)
    .filter(([, key]) => qc.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();

describe("invalidateAfterAction", () => {
  it("refreshes only the written types, their links, and the functions", async () => {
    const qc = cache();
    await invalidateAfterAction(qc, { created: ["d1"], types: ["ReviewDecision"] });
    expect(stale(qc)).toEqual(["decisions", "home"]);
  });

  it("refreshes the links on either side of a written type", async () => {
    const qc = cache();
    await invalidateAfterAction(qc, { modified: ["f1"], types: ["Firm", "ReviewDecision"] });
    expect(stale(qc)).toEqual(["decisions", "firms", "home", "searchFirms", "searchListFirms"]);
  });

  it("refreshes everything when the response names no types", async () => {
    for (const res of [{ created: ["x"] }, { types: [] }]) {
      const qc = cache();
      await invalidateAfterAction(qc, res);
      expect(stale(qc)).toEqual(Object.keys(KEYS).sort());
    }
  });
});
