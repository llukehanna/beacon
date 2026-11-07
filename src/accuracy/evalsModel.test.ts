import { describe, expect, it } from "vitest";
import type { EvalReport } from "../../shared/evalReport";
import {
  deskHref,
  evalCount,
  evalPct,
  exampleFirmName,
  tabFromParam,
  tabTarget,
  tierFraming,
} from "./evalsModel";

describe("evalsModel", () => {
  it("prints a rate to one decimal and a missing rate as a dash", () => {
    expect(evalPct(0.9319)).toBe("93.2");
    expect(evalPct(1)).toBe("100.0");
    expect(evalPct(null)).toBe("—");
  });

  it("links an example to the Desk on that firm", () => {
    expect(deskHref("zephyrleasecurities_australia")).toBe(
      "/desk?firmId=zephyrleasecurities_australia",
    );
  });

  it("separates thousands", () => {
    expect(evalCount(7079)).toBe("7,079");
  });

  it("opens the evals tab only for ?tab=evals", () => {
    expect(tabFromParam("evals")).toBe("evals");
    expect(tabFromParam("operations")).toBe("operations");
    expect(tabFromParam("overview")).toBe("overview");
    expect(tabFromParam("nonsense")).toBe("overview");
    expect(tabFromParam(null)).toBe("overview");
  });

  it("moves between tabs with the arrows (wrapping), Home and End", () => {
    expect(tabTarget("ArrowRight", 0, 3)).toBe(1);
    expect(tabTarget("ArrowRight", 2, 3)).toBe(0);
    expect(tabTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(tabTarget("Home", 2, 3)).toBe(0);
    expect(tabTarget("End", 0, 3)).toBe(2);
    expect(tabTarget("Tab", 0, 3)).toBeNull();
  });
});

describe("tierFraming", () => {
  it("names the abstentions, conflicts and wrong values behind a low tier agreement", () => {
    const failures = [
      { kind: "wrong-source-wins", count: 329, examples: [] },
      { kind: "conflict-surfaced", count: 141, examples: [] },
      { kind: "abstained-correctly", count: 2100, examples: [] },
      { kind: "abstained-wrongly", count: 4, examples: [] },
    ] as EvalReport["failures"];
    const text = tierFraming({ failures } as EvalReport);
    expect(text).toContain("before any analyst input");
    expect(text).toContain("2,104 are abstentions, 141 are conflicts");
    expect(text).toContain("329 are wrong settled values");
  });
});

describe("exampleFirmName", () => {
  it("shows a name, never an id", () => {
    const names = new Map([["ivesco_unitedstates", "Ives & Co."]]);
    expect(exampleFirmName("ivesco_unitedstates", names)).toBe("Ives & Co.");
    expect(exampleFirmName("unknown_firm", names)).toBe("A firm outside this view");
    expect(exampleFirmName("ivesco_unitedstates", undefined)).toBe("…");
  });
});
