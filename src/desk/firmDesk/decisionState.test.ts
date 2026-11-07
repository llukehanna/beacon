import { describe, expect, it } from "vitest";
import { mirrorScore } from "../scoreMirror";
import { confirmItems, firmDecisionState } from "./decisionState";
import { type FirmView, toScoreInput } from "./deskModel";

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
  const firm: FirmView = { firmType: "CS", solvent: true, advisoryConflict: false };
  const mirror = mirrorScore(toScoreInput(firm));

  it("counts gates answered on the record and by staged edits", () => {
    const stored = confirmItems(firm, mirror, {}).find((i) => i.id === "gates");
    expect(stored?.detail).toBe("2/4 gates answered");
    expect(stored?.ok).toBe(false);
    const staged = confirmItems(firm, mirror, { webActivity: true, hasStOrBalanceSheet: false });
    expect(staged.find((i) => i.id === "gates")).toMatchObject({
      detail: "4/4 gates answered",
      ok: true,
    });
  });

  it("reports the scored axes on file against the rubric's total", () => {
    const axes = confirmItems(firm, mirror, {}).find((i) => i.id === "axes");
    expect(axes?.detail).toMatch(/^\d+ of 9 scored axes on file$/);
  });

  it("says a firm that is not scored is hard-rejected, not '0 of 0'", () => {
    const rejected = mirrorScore(toScoreInput({ firmType: "CS", advisoryConflict: true }));
    const axes = confirmItems(firm, rejected, {}).find((i) => i.id === "axes");
    expect(axes?.detail).toBe("not scored: the firm is hard-rejected");
  });

  it("clears the screen on the values on file and still warns when proposals would reject", () => {
    const screen = (p: { hardRejected: boolean; rejectReason: string } | null) =>
      confirmItems(firm, mirror, {}, p).find((i) => i.id === "screen");
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
