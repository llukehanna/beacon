import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { setPersona } from "@/data/persona";
import { type ListRequest, fakeAdapter, pagedRows } from "@/data/testing";
import { fetchAllFindings } from "./fetchFindings";

const finding = (id: string) => ({ findingId: id });

function setup() {
  const requests: ListRequest[] = [];
  const adapter = fakeAdapter({
    listObjects: pagedRows([[finding("a"), finding("b")], [finding("c")]], requests),
  });
  return { adapter, requests, qc: new QueryClient() };
}

afterEach(() => setPersona("analyst"));

describe("fetchAllFindings", () => {
  it("pages through every finding", async () => {
    const { adapter, requests, qc } = setup();
    const rows = await fetchAllFindings(qc, adapter);
    expect(rows.map((r) => r.findingId)).toEqual(["a", "b", "c"]);
    expect(requests.map((r) => r.pageToken)).toEqual([undefined, "1"]);
  });

  it("serves a second export from the query cache", async () => {
    const { adapter, requests, qc } = setup();
    await fetchAllFindings(qc, adapter);
    requests.length = 0;
    const again = await fetchAllFindings(qc, adapter);
    expect(again).toHaveLength(3);
    expect(requests).toHaveLength(0);
  });

  it("fetches again after an action invalidated the findings", async () => {
    const { adapter, requests, qc } = setup();
    await fetchAllFindings(qc, adapter);
    requests.length = 0;
    await qc.invalidateQueries({ queryKey: ["objects", "ResearchFinding"], refetchType: "none" });
    await fetchAllFindings(qc, adapter);
    expect(requests).toHaveLength(2);
  });

  it("does not share a cache entry between personas", async () => {
    const { adapter, requests, qc } = setup();
    await fetchAllFindings(qc, adapter);
    requests.length = 0;
    setPersona("compliance");
    await fetchAllFindings(qc, adapter);
    expect(requests).toHaveLength(2);
  });
});
