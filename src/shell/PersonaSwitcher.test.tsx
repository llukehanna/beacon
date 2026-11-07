// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataAdapterProvider } from "@/data/AdapterContext";
import { useOsdkObjects } from "@/data/hooks";
import { Firm } from "@/data/ontology";
import { getPersona, setPersona } from "@/data/persona";
import { fakeAdapter, pagedRows } from "@/data/testing";
import PersonaSwitcher from "./PersonaSwitcher";

// React's act() warns unless the environment says it is one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => root.unmount());
  }
  setPersona("analyst");
});

function Firms(): React.ReactElement {
  const { data } = useOsdkObjects(Firm);
  return <p>{data?.length ?? 0} firms</p>;
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe("PersonaSwitcher", () => {
  it("persona switch does not refetch the old persona's queries", async () => {
    setPersona("analyst");
    // The persona each request is made as is read when the request is sent, as apiFetch does.
    const askedAs: string[] = [];
    const rows = pagedRows([[{ $apiName: "Firm", $primaryKey: "f1", firmId: "f1" }]]);
    const adapter = fakeAdapter({
      listObjects: (type, opts) => {
        askedAs.push(getPersona());
        return rows(type, opts);
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const refetch = vi.spyOn(qc, "refetchQueries");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const remove = vi.spyOn(qc, "removeQueries");

    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <DataAdapterProvider value={adapter}>
            <PersonaSwitcher />
            <Firms />
          </DataAdapterProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(askedAs).toEqual(["analyst"]);
    const keyPersonas = () =>
      qc
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[q.queryKey.length - 1]);
    expect(keyPersonas()).toEqual(["analyst"]);

    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    await act(async () => {
      select!.value = "compliance";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    // The new persona is fetched once, as the new persona; the old one is never asked again.
    expect(askedAs).toEqual(["analyst", "compliance"]);
    // What the old persona was shown is dropped from the cache, not refetched or merely marked stale.
    expect(keyPersonas()).toEqual(["compliance"]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();

    // And back again: still one fetch per switch.
    await act(async () => {
      select!.value = "analyst";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(askedAs).toEqual(["analyst", "compliance", "analyst"]);
    expect(keyPersonas()).toEqual(["analyst"]);
  });
});
