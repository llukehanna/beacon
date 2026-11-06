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

  it("reports axes known against the rubric's total", () => {
    const axes = confirmItems(firm, mirror, {}).find((i) => i.id === "axes");
    expect(axes?.detail).toMatch(/^\d+\/\d+ axes known$/);
  });
});
