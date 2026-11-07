import { describe, expect, it } from "vitest";
import { EVAL_REPORT } from "../accuracy/evalReportData";
import { groundingCard } from "./groundingCard";

describe("groundingCard", () => {
  it("counts the dropped values, so the rate is not 100% by construction", () => {
    expect(groundingCard({ values: 6472, grounded: 6455 })).toEqual({
      value: "99.7",
      meaning: "of 6,472 extracted values passed grounding · 17 dropped",
    });
  });

  it("reads the recorded run in docs/evals.json", () => {
    const { values, grounded } = EVAL_REPORT.recordedRun;
    const card = groundingCard(EVAL_REPORT.recordedRun);
    expect(card?.meaning).toContain(`${values - grounded} dropped`);
  });

  it("is absent when the run holds no values", () => {
    expect(groundingCard({ values: 0, grounded: 0 })).toBeNull();
  });
});
