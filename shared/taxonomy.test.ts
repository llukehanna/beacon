import { describe, expect, it } from "vitest";
import { ADVISORY } from "./rubric/__fixtures__/advisoryRubric.js";
import { COUNTRY_GEO, REGIONS, expandSelections, matchesSelection } from "./taxonomy.js";

const DEF = ADVISORY.definition;

describe("taxonomy", () => {
  it("maps every region country to a geo entry", () => {
    for (const g of REGIONS) {
      for (const c of g.subs) {
        expect(COUNTRY_GEO[c], c).toBeDefined();
      }
    }
  });

  it("expands group labels, sub-chips and products; reports unknowns", () => {
    const sel = expandSelections(DEF, [
      "Europe",
      "Japan",
      "Capital Solutions",
      "Technology",
      "Martian",
    ]);
    expect(sel.countries.has("Germany")).toBe(true);
    expect(sel.countries.has("Japan")).toBe(true);
    expect([...sel.firmTypes]).toEqual(["CS"]);
    expect(sel.sectors.has("Software")).toBe(true);
    expect(sel.unknown).toEqual(["Martian"]);
  });

  it("matches on every non-empty dimension", () => {
    const sel = expandSelections(DEF, ["United States", "Software"]);
    expect(
      matchesSelection(DEF, { hqCountry: "United States", sector: "Software", thesis: "CF" }, sel),
    ).toBe(true);
    expect(matchesSelection(DEF, { hqCountry: "Canada", sector: "Software" }, sel)).toBe(false);
    expect(matchesSelection(DEF, { hqCountry: "United States", sector: "Retail" }, sel)).toBe(
      false,
    );
  });
});
