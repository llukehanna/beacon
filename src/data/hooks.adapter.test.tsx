// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataAdapterContext, DataAdapterProvider, useDataAdapter } from "./AdapterContext";
import { HttpError, restAdapter } from "./adapter";
import { useLinks, useOsdkAction, useOsdkObjects, useOsdkQuery } from "./hooks";
import { Firm, qualifyFirmAction } from "./ontology";
import { type ListRequest, fakeAdapter, pagedRows } from "./testing";

// React's act() warns unless the environment says it is one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => root.unmount());
  }
});

/** Runs a hook under a fresh query client and the given adapter; `latest()` is its newest result. */
async function renderHook<T>(hook: () => T, adapter = restAdapter) {
  let result: T | undefined;
  function Probe(): null {
    result = hook();
    return null;
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.createElement("div"));
  mounted.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <DataAdapterProvider value={adapter}>
          <Probe />
        </DataAdapterProvider>
      </QueryClientProvider>,
    );
  });
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
  await settle();
  return {
    latest: (): T => {
      if (result === undefined) {
        throw new Error("hook has not rendered");
      }
      return result;
    },
    settle,
  };
}

describe("the data adapter context", () => {
  it("defaults to the REST adapter", async () => {
    const seen = await renderHook(() => React.useContext(DataAdapterContext));
    expect(seen.latest()).toBe(restAdapter);
  });

  it("hands the provided adapter to whoever asks", async () => {
    const fake = fakeAdapter();
    const seen = await renderHook(useDataAdapter, fake);
    expect(seen.latest()).toBe(fake);
  });
});

describe("hooks over a fake adapter", () => {
  it("useOsdkObjects pages through listObjects until the last page", async () => {
    const requests: ListRequest[] = [];
    const adapter = fakeAdapter({
      listObjects: pagedRows([[{ firmId: "a" }, { firmId: "b" }], [{ firmId: "c" }]], requests),
    });
    const { latest, settle } = await renderHook(
      () => useOsdkObjects(Firm, { autoFetchMore: true }),
      adapter,
    );
    await settle();
    await settle();
    expect(latest().data?.map((f) => f.firmId)).toEqual(["a", "b", "c"]);
    expect(latest().hasMore).toBe(false);
    expect(requests).toEqual([
      { type: "Firm", pageToken: undefined },
      { type: "Firm", pageToken: "1" },
    ]);
  });

  it("useOsdkObjects reports a failure and retries on refetch", async () => {
    const listObjects = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("database unavailable", 503))
      .mockResolvedValue({ data: [{ firmId: "a" }], nextPageToken: null });
    const { latest, settle } = await renderHook(
      () => useOsdkObjects(Firm),
      fakeAdapter({ listObjects }),
    );
    expect(latest().error?.message).toBe("database unavailable");
    await act(() => latest().refetch());
    await settle();
    expect(latest().error).toBeUndefined();
    expect(latest().data?.map((f) => f.firmId)).toEqual(["a"]);
  });

  it("useOsdkQuery runs the function through the adapter, and waits on null params", async () => {
    const runFunction = vi.fn().mockResolvedValue({ axes: [] });
    const adapter = fakeAdapter({ runFunction });
    const ready = await renderHook(
      () => useOsdkQuery("firmObservations", { firmId: "f1" }),
      adapter,
    );
    expect(runFunction).toHaveBeenCalledWith("firmObservations", { firmId: "f1" });
    expect(ready.latest().data).toEqual({ axes: [] });

    runFunction.mockClear();
    const waiting = await renderHook(() => useOsdkQuery("firmObservations", null), adapter);
    expect(runFunction).not.toHaveBeenCalled();
    expect(waiting.latest().isLoading).toBe(false);
  });

  it("useOsdkAction sends the parameters through the adapter", async () => {
    const applyAction = vi.fn().mockResolvedValue({ types: ["Firm"] });
    const { latest } = await renderHook(
      () => useOsdkAction(qualifyFirmAction),
      fakeAdapter({ applyAction }),
    );
    await act(async () => {
      await latest().applyAction({ firm: "f1" });
    });
    expect(applyAction).toHaveBeenCalledWith("qualifyFirm", { firm: "f1" });
  });

  it("useOsdkAction rejects with the adapter's error and keeps it on `error`", async () => {
    const applyAction = vi
      .fn()
      .mockRejectedValue(new HttpError("Firm f1 is already qualified", 409));
    const { latest, settle } = await renderHook(
      () => useOsdkAction(qualifyFirmAction),
      fakeAdapter({ applyAction }),
    );
    let thrown: unknown;
    await act(async () => {
      thrown = await latest()
        .applyAction({ firm: "f1" })
        .catch((e: unknown) => e);
    });
    await settle();
    expect(thrown).toBeInstanceOf(HttpError);
    expect(latest().error?.message).toBe("Firm f1 is already qualified");
  });

  it("useLinks traverses through the adapter", async () => {
    const listLinked = vi.fn().mockResolvedValue({ s1: [{ $apiName: "Firm", $primaryKey: "f1" }] });
    const { latest } = await renderHook(
      () => useLinks({ $apiName: "SearchList", $primaryKey: "s1" }, "firms"),
      fakeAdapter({ listLinked }),
    );
    expect(listLinked).toHaveBeenCalledWith("SearchList", "firms", ["s1"]);
    expect(latest().linkedObjectsBySourcePrimaryKey.get("s1")).toHaveLength(1);
  });
});
