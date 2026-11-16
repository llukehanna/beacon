import { describe, expect, it } from "vitest";
import { ADVISORY, withTraits } from "../../../shared/rubric/__fixtures__/advisoryRubric";
import { confirmItems, firmDecisionState } from "./decisionState";
import { type FirmView, previewScore } from "./deskModel";

describe("firmDecisionState", () => {
  it("offers Qualify before the Qualified stage", () => {
    const s = firmDecisionState({ lifecycleState: "Screening" });
    expect(s).toMatchObject({ qualified: false, terminalKind: null, nextState: null });
  });

  it("offers Advance to the next stage once qualified", () => {
    const s = firmDecisionState({ lifecycleState: "Qualified" });
    expect(s).toMatchObject({ qualified: true, terminalKind: null, nextState: "Outreach" });
  });

  it("has nothing to advance to at Closed, and treats it as terminal", () => {
    const s = firmDecisionState({ lifecycleState: "Closed" });
    expect(s).toMatchObject({ terminalKind: "closed", nextState: null });
  });

  it("treats a firm passed in either field as passed", () => {
    expect(firmDecisionState({ lifecycleState: "Passed" })).toMatchObject({
      terminalKind: "passed",
      stageLabel: "Passed",
      qualified: false,
    });
    expect(
      firmDecisionState({ lifecycleState: "Qualified", currentStage: "rejected" }),
    ).toMatchObject({ terminalKind: "passed", qualified: false });
  });

  it("falls back to the current stage when there is no lifecycle state", () => {
    expect(firmDecisionState({ currentStage: "NDA" }).nextState).toBe("IOI");
  });
});

describe("confirmItems", () => {
  const firm: FirmView = withTraits({ firmType: "CS", solvent: true, advisoryConflict: false });
  const mirror = previewScore(ADVISORY, firm);

  it("counts gates answered on the record and by staged edits", () => {
    const stored = confirmItems(ADVISORY, firm, mirror, {}).find((i) => i.id === "gates");
    expect(stored?.detail).toBe("2/4 gates answered");
    expect(stored?.ok).toBe(false);
    const staged = confirmItems(ADVISORY, firm, mirror, {
      web_activity: true,
      has_st_or_balance_sheet: false,
    });
    expect(staged.find((i) => i.id === "gates")).toMatchObject({
      detail: "4/4 gates answered",
      ok: true,
    });
  });

  it("reports the scored axes on file against the rubric's total", () => {
    const axes = confirmItems(ADVISORY, firm, mirror, {}).find((i) => i.id === "axes");
    expect(axes?.detail).toMatch(/^\d+ of 9 scored axes on file$/);
  });

  it("says a firm that is not scored is hard-rejected, not '0 of 0'", () => {
    const rejected = previewScore(ADVISORY, withTraits({ firmType: "CS", advisoryConflict: true }));
    const axes = confirmItems(ADVISORY, firm, rejected, {}).find((i) => i.id === "axes");
    expect(axes?.detail).toBe("not scored: the firm is hard-rejected");
  });

  it("clears the screen on the values on file and still warns when proposals would reject", () => {
    const screen = (p: { hardRejected: boolean; rejectReason: string } | null) =>
      confirmItems(ADVISORY, firm, mirror, {}, p).find((i) => i.id === "screen");
    expect(screen(null)).toMatchObject({ label: "Cleared the hard screen", ok: true });
    expect(screen({ hardRejected: false, rejectReason: "" })?.detail).toBe("no rejection triggers");
    const warned = screen({
      hardRejected: true,
      rejectReason: "Advisory conflict (CS hard-reject)",
    });
    expect(warned).toMatchObject({
      label: "Cleared the hard screen on the values on file",
      detail:
        "would be hard-rejected if proposals are verified: Advisory conflict (CS hard-reject)",
      ok: true,
    });
  });
});
