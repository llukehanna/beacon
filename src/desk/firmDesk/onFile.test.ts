import { describe, expect, it } from "vitest";
import { ENRICH_AXES } from "../../../shared/vocab";
import { mirrorScore } from "../scoreMirror";
import { buildAxisRows } from "./axisRows";
import { type FirmView, toScoreInput } from "./deskModel";
import { buildOnFile } from "./onFile";

const CS = ENRICH_AXES.filter((a) => a.models.includes("CS"));

function view(firm: FirmView, edits = {}) {
  const rows = buildAxisRows(CS, undefined, []);
  const mirror = mirrorScore({ ...toScoreInput(firm), ...edits });
  return buildOnFile(rows, firm, edits, mirror);
}

describe("buildOnFile", () => {
  const firm: FirmView = {
    firmType: "CS",
    servicesFit: "Full private-capital suite",
    dealSizeMUsd: 40,
    solvent: true,
    advisoryConflict: false,
  };

  it("reads each axis's value from the firm record with its rubric points", () => {
    const onFile = view(firm);
    expect(onFile.services_fit).toEqual({
      text: "Full private-capital suite",
      band: 2,
      pending: false,
    });
    expect(onFile.deal_size_usd_m).toEqual({ text: "40", band: 1, pending: false });
  });

  it("words gates as Pass or Fail and gives them no points", () => {
    const onFile = view(firm);
    expect(onFile.solvent).toEqual({ text: "Pass", band: null, pending: false });
    expect(onFile.advisory_conflict).toEqual({ text: "Pass", band: null, pending: false });
  });

  it("leaves out axes with no value on file", () => {
    const onFile = view(firm);
    expect(onFile.firm_age).toBeUndefined();
    expect(onFile.md_pedigree).toBeUndefined();
  });

  it("prefers a staged edit to the stored value and marks it pending", () => {
    const onFile = view(firm, { dealSizeMUsd: 200 });
    expect(onFile.deal_size_usd_m).toEqual({ text: "200", band: 2, pending: true });
  });

  it("reads the balance-sheet gate through its SDK spelling", () => {
    expect(view({ ...firm, hasSTOrBalanceSheet: true }).has_st_or_balance_sheet?.text).toBe("Fail");
  });
});
