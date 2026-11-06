import { describe, expect, it } from "vitest";
import type { FacetGroup } from "../../shared/taxonomy";
import {
  customValues,
  dropOption,
  findIdx,
  mergeValues,
  pickOption,
  toggleCategory,
  toggleValue,
} from "./facetModel";

const energy: FacetGroup = { label: "Energy", subs: ["Oil and Gas", "Renewables"] };
const infra: FacetGroup = { label: "Infrastructure", subs: ["Oil and Gas", "Utilities"] };
const groups = [energy, infra];

describe("toggleValue", () => {
  it("adds, then removes, ignoring case", () => {
    expect(toggleValue([], "Renewables")).toEqual(["Renewables"]);
    expect(toggleValue(["Renewables"], "renewables")).toEqual([]);
    expect(findIdx(["A"], "a")).toBe(0);
  });
});

describe("toggleCategory", () => {
  it("picks the category with every sub-option, without repeating those already picked", () => {
    expect(toggleCategory(["Renewables"], energy, groups)).toEqual([
      "Renewables",
      "Energy",
      "Oil and Gas",
    ]);
  });

  it("drops the category and its sub-options", () => {
    expect(toggleCategory(["Energy", "Oil and Gas", "Renewables"], energy, groups)).toEqual([]);
  });

  it("keeps a sub-option another picked category owns", () => {
    const picked = ["Energy", "Oil and Gas", "Renewables", "Infrastructure"];
    expect(toggleCategory(picked, energy, groups)).toEqual(["Oil and Gas", "Infrastructure"]);
  });

  it("keeps custom entries", () => {
    expect(toggleCategory(["Energy", "Oil and Gas", "Hydrogen"], energy, groups)).toEqual([
      "Hydrogen",
    ]);
  });
});

describe("customValues", () => {
  it("lists what is outside the taxonomy", () => {
    expect(customValues(["Energy", "hydrogen", "utilities"], groups)).toEqual(["hydrogen"]);
  });
});

describe("mergeValues", () => {
  it("merges lists without blanks or repeats", () => {
    expect(mergeValues(["Audit", " "], ["audit", "Tax"])).toEqual(["Audit", "Tax"]);
  });
});

describe("pickOption and dropOption", () => {
  it("pick a category with its sub-options, or a sub-option alone, and never twice", () => {
    expect(pickOption([], "Energy", groups)).toEqual(["Energy", "Oil and Gas", "Renewables"]);
    expect(pickOption([], "Utilities", groups)).toEqual(["Utilities"]);
    expect(pickOption(["utilities"], "Utilities", groups)).toEqual(["utilities"]);
  });

  it("drop what pickOption added, and ignore what is not picked", () => {
    expect(dropOption(["Energy", "Oil and Gas", "Renewables"], "Energy", groups)).toEqual([]);
    expect(dropOption(["Utilities", "Hydrogen"], "Utilities", groups)).toEqual(["Hydrogen"]);
    expect(dropOption(["Hydrogen"], "Utilities", groups)).toEqual(["Hydrogen"]);
  });
});
