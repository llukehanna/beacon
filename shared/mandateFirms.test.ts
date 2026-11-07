import { describe, expect, it } from "vitest";
import { countMandateFirms, mandateFirmCounts, mandateFirmIds } from "./mandateFirms.js";

describe("mandateFirmIds", () => {
  const input = {
    searches: [{ searchId: "s1", mandateId: "m1" }],
    memberships: [{ searchId: "s1", firmId: "a" }],
    firms: [
      { firmId: "b", discoveredViaSearchId: "s1" },
      { firmId: "c", discoveredViaSearchId: null },
    ],
    searchLists: [{ searchId: "l1", mandateId: "m1" }],
    searchListFirmIds: new Map([["l1", ["c", "a"]]]),
  };

  it("names the firms behind each count", () => {
    const ids = mandateFirmIds(input).get("m1")!;
    expect([...ids.scoped].sort()).toEqual(["a", "b", "c"]);
    expect([...ids.fromSearches].sort()).toEqual(["a", "b"]);
  });

  it("keeps the counts the sizes of those sets", () => {
    expect(mandateFirmCounts(input).get("m1")).toEqual({ scoped: 3, fromSearches: 2 });
    expect(countMandateFirms(mandateFirmIds(input))).toEqual(mandateFirmCounts(input));
  });
});
