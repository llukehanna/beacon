import { describe, expect, it } from "vitest";
import { axisLabel, isKnownAxis } from "./axisLabels";
import { ADVISORY } from "./rubric/__fixtures__/advisoryRubric";
import { TOY_RUBRIC as TOY } from "./rubric/__fixtures__/toyRubric";
import { scoreTraits } from "./rubric/engine";

const label = (raw: string | undefined): string => axisLabel(ADVISORY, raw);

describe("axisLabel", () => {
  it("gives every spelling of an axis the one label", () => {
    for (const raw of ["deal_size_usd_m", "Deal Size", "Avg deal size"]) {
      expect(label(raw)).toBe("Avg deal size");
    }
    for (const raw of ["md_pedigree", "MD Experience"]) {
      expect(label(raw)).toBe("MD pedigree");
    }
    for (const raw of ["fee_generating_count", "Fee-Generating"]) {
      expect(label(raw)).toBe("Fee-earning heads");
    }
    for (const raw of ["services_fit", "Services", "CS Services Fit"]) {
      expect(label(raw)).toBe("Services fit");
    }
    for (const raw of ["employees", "Headcount"]) {
      expect(label(raw)).toBe("Headcount");
    }
  });

  it("names every trait in the catalog, gates included, without auto-title-cased keys", () => {
    for (const t of ADVISORY.traits) {
      expect(isKnownAxis(ADVISORY, t.traitKey)).toBe(true);
      expect(label(t.traitKey)).not.toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)+$/);
    }
    expect(label("has_st_or_balance_sheet")).toBe("Sales & trading / balance sheet");
  });

  it("names every axis the rubric scores, for both theses", () => {
    for (const thesis of ["CF", "CS"]) {
      for (const a of scoreTraits(ADVISORY.definition, thesis, { geo_score: 1 }).axisScores) {
        expect(isKnownAxis(ADVISORY, a.axis), a.axis).toBe(true);
      }
    }
  });

  it("writes an unknown axis in sentence case, never Title Case", () => {
    expect(label("new_custom_axis")).toBe("New custom axis");
    expect(label("")).toBe("unknown axis");
    expect(label(undefined)).toBe("unknown axis");
  });

  it("uses sentence case throughout", () => {
    for (const t of ADVISORY.traits) {
      // After the first word, only acronyms (MD) and "Sales & trading" style words keep a capital.
      expect(label(t.traitKey).slice(1)).not.toMatch(/ [A-Z][a-z]/);
    }
  });

  it("names another workspace's axes from its own catalog", () => {
    const traitKey = TOY.traits[0].traitKey;
    expect(axisLabel(TOY, traitKey)).toBe(TOY.traits[0].label);
    expect(isKnownAxis(TOY, "deal_size_usd_m")).toBe(false);
  });
});
