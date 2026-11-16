import { describe, expect, it } from "vitest";
import { ADVISORY, withTraits } from "../../../shared/rubric/__fixtures__/advisoryRubric";
import { buildAxisRows } from "./axisRows";
import { type EditMap, type FirmView, previewScore } from "./deskModel";
import { buildOnFile } from "./onFile";

function view(firm: FirmView, edits: EditMap = {}) {
  const rows = buildAxisRows(ADVISORY, "CS", undefined, []);
  return buildOnFile(ADVISORY, rows, firm, edits, previewScore(ADVISORY, firm, edits));
}

describe("buildOnFile", () => {
  const firm: FirmView = withTraits({
    thesis: "CS",
    servicesFit: "Full private-capital suite",
    dealSizeMUsd: 40,
    solvent: true,
    advisoryConflict: false,
  });

  it("reads each axis's value from the firm record with its rubric points", () => {
    const onFile = view(firm);
    expect(onFile.services_fit).toEqual({
      text: "Full private-capital suite",
      band: 2,
      bandMax: 2,
      pending: false,
    });
    expect(onFile.deal_size_usd_m).toEqual({
      text: "$40m",
      band: 1,
      bandMax: 2,
      pending: false,
    });
  });

  it("words gates as Pass or Fail and gives them no points", () => {
    const onFile = view(firm);
    expect(onFile.solvent).toEqual({ text: "Pass", band: null, bandMax: null, pending: false });
    expect(onFile.advisory_conflict).toEqual({
      text: "Pass",
      band: null,
      bandMax: null,
      pending: false,
    });
  });

  it("leaves out axes with no value on file", () => {
    const onFile = view(firm);
    expect(onFile.firm_age).toBeUndefined();
    expect(onFile.md_pedigree).toBeUndefined();
  });

  it("prefers a staged edit to the stored value and marks it pending", () => {
    const onFile = view(firm, { deal_size_usd_m: 200 });
    expect(onFile.deal_size_usd_m).toEqual({
      text: "$200m",
      band: 2,
      bandMax: 2,
      pending: true,
    });
  });

  it("reads a gate from the firm's traits", () => {
    const gated = withTraits({
      ...firm,
      traits: { ...firm.traits, has_st_or_balance_sheet: true },
    });
    expect(view(gated).has_st_or_balance_sheet?.text).toBe("Fail");
  });
});
