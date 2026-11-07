import { describe, expect, it } from "vitest";
import {
  type DriftLike,
  type FirmLike,
  agoText,
  buildDriftItems,
  driftRow,
  formatChangeValue,
  kindFor,
} from "./driftModel";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const DAY = 86_400_000;

const firm = (id: string, state: string, over: Partial<FirmLike> = {}): FirmLike => ({
  firmId: id,
  firmName: `Firm ${id}`,
  lifecycleState: state,
  ...over,
});

const drift = (id: string, firmId: string, over: Partial<DriftLike> = {}): DriftLike => ({
  driftEventId: id,
  firmId,
  driftStatus: "open",
  driftReason: "tier_moved",
  priorTier: "B",
  priorScore: 12,
  newTier: "C",
  newScore: 9,
  detectedAt: new Date(NOW - 2 * DAY).toISOString(),
  ...over,
});

describe("kindFor", () => {
  it("offers passed firms a way back in and pipeline firms a way to stay or go", () => {
    expect(kindFor(firm("a", "Passed"))).toBe("passed");
    expect(kindFor(firm("a", "Qualified"))).toBe("pipeline");
    expect(kindFor(firm("a", "Closed"))).toBe("pipeline");
  });

  it("offers nothing before qualification, or before the firm has loaded", () => {
    expect(kindFor(firm("a", "Screening"))).toBeNull();
    expect(kindFor(firm("a", ""))).toBeNull();
    expect(kindFor(undefined)).toBeNull();
  });
});

describe("buildDriftItems", () => {
  it("lists open events before resolved ones, each in the order given", () => {
    const { open, resolved } = buildDriftItems(
      [
        drift("d1", "a", { driftStatus: "resolved", resolution: "kept_passed" }),
        drift("d2", "a"),
        drift("d3", "b"),
      ],
      [firm("a", "Qualified"), firm("b", "Passed")],
      [],
    );
    expect(open.map((i) => i.drift.driftEventId)).toEqual(["d2", "d3"]);
    expect(resolved.map((i) => i.drift.driftEventId)).toEqual(["d1"]);
  });

  it("names the firm, falling back to its id and then to Unknown firm", () => {
    const { open } = buildDriftItems(
      [drift("d1", "a"), drift("d2", "ghost"), drift("d3", "")],
      [firm("a", "Qualified")],
      [],
    );
    expect(open.map((i) => i.firmName)).toEqual(["Firm a", "ghost", "Unknown firm"]);
  });

  it("gives a Closed firm no pass decision", () => {
    const { open } = buildDriftItems(
      [drift("d1", "a"), drift("d2", "b")],
      [firm("a", "Closed"), firm("b", "NDA")],
      [],
    );
    expect(open.map((i) => i.canPass)).toEqual([false, true]);
  });

  it("reads the pass reason from the newest reject decision only", () => {
    const { open } = buildDriftItems(
      [drift("d1", "a", { driftReason: "outcome_diverged" })],
      [firm("a", "Passed", { outcome: "acquired_by_competitor" })],
      [
        { firmId: "a", decisionType: "keep_passed", rejectionRationale: "still too small" },
        { firmId: "a", decisionType: "reject", rejectionRationale: "no fee-earners" },
        { firmId: "a", decisionType: "reject", rejectionRationale: "older reason" },
      ],
    );
    expect(open[0].rejectionReason).toBe("no fee-earners");
    expect(open[0].observedOutcome).toBe("acquired_by_competitor");
  });

  it("finds passed firms that share a stale reason, only for an invalidated pass", () => {
    const changedAxes = JSON.stringify([{ axis: "firm_age", old: 2, new: 9 }]);
    const firms = [firm("a", "Passed"), firm("b", "Passed"), firm("c", "Qualified")];
    const decisions = [
      { firmId: "a", decisionType: "reject", rejectionRationale: "firm age too low" },
      { firmId: "b", decisionType: "reject", rejectionRationale: "firm age under five years" },
    ];
    const invalidated = buildDriftItems(
      [drift("d1", "a", { driftReason: "pass_reason_invalidated", changedAxes })],
      firms,
      decisions,
    ).open[0];
    expect(invalidated.lookalikes.total).toBe(1);
    expect(invalidated.lookalikes.firms[0].firmId).toBe("b");

    const moved = buildDriftItems([drift("d1", "a", { changedAxes })], firms, decisions).open[0];
    expect(moved.lookalikes.total).toBe(0);
  });

  it("leaves a resolved event with no reason, outcome or lookalikes", () => {
    const { resolved } = buildDriftItems(
      [drift("d1", "a", { driftStatus: "Resolved", resolution: "re_engaged" })],
      [firm("a", "Passed", { outcome: "went_cold" })],
      [{ firmId: "a", decisionType: "reject", rejectionRationale: "too small" }],
    );
    expect(resolved[0].resolved).toBe(true);
    expect(resolved[0].rejectionReason).toBeNull();
    expect(resolved[0].observedOutcome).toBeNull();
  });
});

describe("driftRow", () => {
  const item = (d: DriftLike, f: FirmLike = firm("a", "Qualified")) =>
    buildDriftItems([d], [f], []).open[0] ?? buildDriftItems([d], [f], []).resolved[0];

  it("marks a drop red, with the tier change and its age", () => {
    const row = driftRow(item(drift("d1", "a")), NOW);
    expect(row).toMatchObject({
      mark: "↓",
      tone: "down",
      reason: "tier moved after new evidence",
      figure: { from: "B 12", to: "C 9" },
      moved: "down",
      age: "2d",
    });
  });

  it("marks a rise green", () => {
    const row = driftRow(
      item(drift("d1", "a", { priorTier: "C", priorScore: 8, newTier: "B", newScore: 11 })),
      NOW,
    );
    expect(row).toMatchObject({ mark: "↑", tone: "up", moved: "up" });
  });

  it("marks an invalidated pass reason as needing attention", () => {
    const row = driftRow(item(drift("d1", "a", { driftReason: "pass_reason_invalidated" })), NOW);
    expect(row).toMatchObject({
      tone: "attention",
      reason: "the reason we passed no longer holds",
    });
  });

  it("tells the divergence story without a tier figure", () => {
    const row = driftRow(item(drift("d1", "a", { driftReason: "outcome_diverged" })), NOW);
    expect(row).toMatchObject({
      tone: "divergence",
      reason: "passed; later acquired by a competitor",
      figure: null,
    });
  });

  it("knows a firm acquired by a competitor is gone, open or resolved", () => {
    const acquired = firm("a", "Passed", { outcome: "acquired_by_competitor" });
    const open = item(drift("d1", "a", { driftReason: "outcome_diverged" }), acquired);
    expect(open.firmGone).toBe(true);
    expect(open.kind).toBe("passed");
    expect(item(drift("d1", "a"), firm("a", "Passed", { outcome: "went_cold" })).firmGone).toBe(
      false,
    );
    expect(item(drift("d1", "a"), firm("a", "Passed")).firmGone).toBe(false);

    // Keeping an acquired firm passed is recording the lesson; on any other firm it is still that.
    const settled = (f: FirmLike) =>
      driftRow(
        item(
          drift("d1", "a", {
            driftReason: "outcome_diverged",
            driftStatus: "resolved",
            resolution: "kept_passed",
          }),
          f,
        ),
        NOW,
      ).resolution;
    expect(settled(acquired)).toBe("Lesson recorded");
    expect(settled(firm("a", "Passed"))).toBe("Kept passed");

    // An earlier tier-drift event, kept passed before the acquisition, is not the lesson.
    const earlier = driftRow(
      item(
        drift("d0", "a", {
          driftReason: "pass_reason_invalidated",
          driftStatus: "resolved",
          resolution: "kept_passed",
        }),
        acquired,
      ),
      NOW,
    );
    expect(earlier.resolution).toBe("Kept passed");
  });

  it("shows how a resolved event was settled", () => {
    const row = driftRow(
      item(drift("d1", "a", { driftStatus: "resolved", resolution: "kept_in_pipeline" })),
      NOW,
    );
    expect(row.resolved).toBe(true);
    expect(row.resolution).toBe("Kept in pipeline");
  });

  it("has no age without a detection time", () => {
    expect(driftRow(item(drift("d1", "a", { detectedAt: undefined })), NOW).age).toBeNull();
  });

  it("has no tier figure without both tiers", () => {
    const row = driftRow(item(drift("d1", "a", { priorTier: undefined })), NOW);
    expect(row.figure).toBeNull();
  });
});

describe("detail wording", () => {
  it("shows a dash for an absent change value and text for the rest", () => {
    expect(formatChangeValue(null)).toBe("—");
    expect(formatChangeValue(undefined)).toBe("—");
    expect(formatChangeValue("Founder-owned")).toBe("Founder-owned");
    expect(formatChangeValue(5.3)).toBe("5.3");
    expect(formatChangeValue({ a: 1 })).toBe('{"a":1}');
  });

  it("reads a recorded time as how long ago, and a plain date as written", () => {
    expect(agoText(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe("3d ago");
    expect(agoText(new Date(NOW - 5000).toISOString(), NOW)).toBe("just now");
    expect(agoText("Q3 2026", NOW)).toBe("Q3 2026");
    expect(agoText("", NOW)).toBeNull();
    expect(agoText(undefined, NOW)).toBeNull();
  });
});
