import { QueryClient } from "@tanstack/react-query";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type ActionParams } from "../../shared/actionParams";
import type { ShellCounts, SourceDocumentView } from "../../shared/summaries";
import { invalidateAfterAction, type useOsdkAction, useOsdkQuery } from "./hooks";

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

describe("useOsdkAction parameters", () => {
  type Apply<N extends Parameters<typeof useOsdkAction>[0]["apiName"]> = ReturnType<
    typeof useOsdkAction<N>
  >["applyAction"];

  it("takes exactly the parameters the server validates", () => {
    // Only the types matter: a stub stands in for the hook, and `tsc` checks the directives below.
    const reject: Apply<"rejectFirm"> = () => Promise.resolve({});
    void reject({ firm: "f1", rejectionRationale: "no fit" });
    // @ts-expect-error the rationale is required
    void reject({ firm: "f1" });
    // @ts-expect-error a parameter the action does not declare
    void reject({ firm: "f1", rejectionRationale: "no fit", extra: 1 });
    // @ts-expect-error an object parameter travels as its primary key
    void reject({ firm: { firmId: "f1" }, rejectionRationale: "no fit" });

    const acknowledge: Apply<"acknowledgeDrift"> = () => Promise.resolve({});
    void acknowledge({ driftEvent: "d1" });
    void acknowledge({ driftEvent: "d1", note: null });
    // @ts-expect-error a nullable parameter is a string or null
    void acknowledge({ driftEvent: "d1", note: 3 });

    const cluster: Apply<"clusterRejections"> = () => Promise.resolve({});
    void cluster({});
    // @ts-expect-error this action takes no parameters
    void cluster({ firm: "f1" });

    expectTypeOf<Parameters<Apply<"qualifyFirm">>[0]>().toEqualTypeOf<
      ActionParams<"qualifyFirm">
    >();
    expectTypeOf<Parameters<Apply<"qualifyFirm">>[0]>().toHaveProperty("firm").toBeString();
    expectTypeOf<ReturnType<Apply<"qualifyFirm">>>().resolves.toHaveProperty("created");
  });
});

describe("useOsdkQuery types", () => {
  it("types each function's parameters and result", () => {
    // Only the types matter: the component is never rendered, and `tsc` checks the directives below.
    const TypeChecks = (): void => {
      expectTypeOf(useOsdkQuery("shellCounts").data).toEqualTypeOf<ShellCounts | undefined>();
      expectTypeOf(
        useOsdkQuery("sourceDocument", { provider: "p", firmId: "f" }).data,
      ).toEqualTypeOf<SourceDocumentView | undefined>();
      void useOsdkQuery("sourceDocument", null);
      // @ts-expect-error a function that takes parameters needs them (or null while unknown)
      void useOsdkQuery("firmObservations");
      // @ts-expect-error not a query function
      void useOsdkQuery("noSuchFunction");
      // @ts-expect-error a parameter the function does not take
      void useOsdkQuery("firmObservations", { firmId: "f", extra: 1 });
    };
    expect(TypeChecks).toBeTypeOf("function");
  });
});
