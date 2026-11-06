import { describe, expect, it } from "vitest";
import { deskHref, evalCount, evalPct, tabFromParam, tabTarget } from "./evalsModel";

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
