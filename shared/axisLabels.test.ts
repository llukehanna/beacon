import { describe, expect, it } from "vitest";
import { axisLabel, isKnownAxis } from "./axisLabels";
import { mirrorScore } from "./scoreMirror";
import { ENRICH_AXES } from "./vocab";

describe("axisLabel", () => {
  it("gives every spelling of an axis the one label", () => {
    for (const raw of ["deal_size_usd_m", "dealSizeMUsd", "Deal Size", "deal_size"]) {
      expect(axisLabel(raw)).toBe("Avg deal size");
    }
    for (const raw of ["md_pedigree", "mdPedigree", "MD Experience"]) {
      expect(axisLabel(raw)).toBe("MD pedigree");
    }
    for (const raw of ["fee_generating_count", "Fee-Generating"]) {
      expect(axisLabel(raw)).toBe("Fee-earning heads");
    }
    for (const raw of ["services_fit", "Services", "CS Services Fit"]) {
      expect(axisLabel(raw)).toBe("Services fit");
    }
    for (const raw of ["employees", "Headcount"]) {
      expect(axisLabel(raw)).toBe("Headcount");
    }
  });

  it("names every enrichable axis, gates included, without auto-title-cased keys", () => {
    for (const a of ENRICH_AXES) {
      expect(isKnownAxis(a.axis)).toBe(true);
      expect(axisLabel(a.axis)).not.toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)+$/);
    }
    expect(axisLabel("has_st_or_balance_sheet")).toBe("Sales & trading / balance sheet");
  });

  it("names every axis the rubric mirror scores, for both models", () => {
    for (const firmType of ["CF", "CS"]) {
      for (const a of mirrorScore({ firmType, geoScore: 1 }).axisScores) {
        expect(isKnownAxis(a.axis), a.axis).toBe(true);
      }
    }
  });

  it("writes an unknown axis in sentence case, never Title Case", () => {
    expect(axisLabel("new_custom_axis")).toBe("New custom axis");
    expect(axisLabel("")).toBe("unknown axis");
    expect(axisLabel(undefined)).toBe("unknown axis");
  });

  it("uses sentence case throughout", () => {
    const labels = ENRICH_AXES.map((a) => axisLabel(a.axis));
    for (const l of labels) {
      // After the first word, only acronyms (MD) and "Sales & trading" style words keep a capital.
      expect(l.slice(1)).not.toMatch(/ [A-Z][a-z]/);
    }
  });
});
