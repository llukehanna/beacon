// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { ADVISORY } from "../../shared/rubric/__fixtures__/advisoryRubric";
import type { ObjectTypeName } from "../../shared/schema";
import { DataAdapterProvider } from "./AdapterContext";
import { RubricProvider } from "./RubricProvider";
import { setPersona } from "./persona";
import { useRubric } from "./rubricContext";
import { fakeAdapter } from "./testing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RUBRIC_ROW = {
  rubricId: "advisory-acquisitions@1",
  active: true,
  definitionJson: JSON.stringify(ADVISORY.definition),
};
const TRAIT_ROWS = ADVISORY.traits.map((t, position) => ({
  traitId: `ws:${t.traitKey}`,
  traitKey: t.traitKey,
  label: t.label,
  description: t.description,
  unit: t.unit ?? undefined,
  kind: t.kind,
  role: t.role,
  optionsJson: t.options === null ? undefined : JSON.stringify(t.options),
  passWhen: t.passWhen ?? undefined,
  thesesJson: t.theses === null ? undefined : JSON.stringify(t.theses),
  position,
}));

/** An adapter whose Rubric reads fail until `heal()`, or wait until `release()` while `hold`. */
function adapter() {
  const state = { failing: false, hold: false, waiting: [] as (() => void)[] };
  const a = fakeAdapter({
    listObjects: ((type: ObjectTypeName) => {
      if (type === "Rubric" && state.failing) {
        return Promise.reject(new Error("rubric fetch failed"));
      }
      const page = { data: type === "Rubric" ? [RUBRIC_ROW] : TRAIT_ROWS, nextPageToken: null };
      return state.hold
        ? new Promise((resolve) => state.waiting.push(() => resolve(page)))
        : Promise.resolve(page);
    }) as never,
  });
  return { a, state };
}

let mounts = 0;
function Child(): React.ReactElement {
  const rubric = useRubric();
  React.useEffect(() => {
    mounts += 1;
  }, []);
  return <p>rubric {rubric.rubricId}</p>;
}

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    act(() => r.unmount());
  }
  setPersona("analyst");
});

async function mount(a: ReturnType<typeof fakeAdapter>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <DataAdapterProvider value={a}>
          <RubricProvider>
            <Child />
          </RubricProvider>
        </DataAdapterProvider>
      </QueryClientProvider>,
    );
  });
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
  await settle();
  return { host, qc, settle };
}

describe("RubricProvider", () => {
  it("says the rubric could not load and offers a retry, instead of loading forever", async () => {
    const { a, state } = adapter();
    state.failing = true;
    const { host, settle } = await mount(a);
    expect(host.textContent).toMatch(/could not load the scoring rubric/i);
    const retry = [...host.querySelectorAll("button")].find((b) =>
      /retry/i.test(b.textContent ?? ""),
    );
    expect(retry).toBeDefined();
    state.failing = false;
    await act(async () => retry!.click());
    await settle();
    expect(host.textContent).toContain("rubric advisory-acquisitions@1");
  });

  it("keeps the pages mounted while a persona switch reloads the rubric", async () => {
    const { a, state } = adapter();
    const { host, qc, settle } = await mount(a);
    expect(host.textContent).toContain("rubric advisory-acquisitions@1");
    const before = mounts;
    state.hold = true;
    await act(async () => {
      setPersona("compliance");
      qc.removeQueries({ queryKey: ["objects"] });
    });
    await settle();
    // The new persona's read is still in flight: the last rubric stays, nothing remounts.
    expect(host.textContent).toContain("rubric advisory-acquisitions@1");
    expect(mounts).toBe(before);
    state.hold = false;
    await act(async () => state.waiting.splice(0).forEach((go) => go()));
    await settle();
    expect(mounts).toBe(before);
  });
});
