import { describe, expect, it } from "vitest";
import { DEFAULT_SORT } from "@/desk/pipelineRows";
import {
  type FirmView,
  NO_PROFILE_FILTER,
  STAGE_FILTERS,
  activityText,
  buildRows,
  firmFacts,
  labelForDecisionType,
  lastActivityByFirm,
  rowsForStage,
  sortSummary,
  stageCounts,
  stageFromParam,
  stageToParam,
} from "./pipelineModel";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const HOUR = 3_600_000;

function firm(id: string, over: Partial<FirmView> = {}): FirmView {
  return { firmId: id, firmName: `Firm ${id}`, firmType: "CF", ...over };
}

const rows = (firms: FirmView[], query = "") =>
  buildRows({
    firms,
    query,
    profile: NO_PROFILE_FILTER,
    sort: DEFAULT_SORT,
    rejectByFirm: new Map(),
    activityByFirm: new Map(),
  });

describe("stage filter", () => {
  it("offers every firm, the eight stages and Passed, in order", () => {
    expect(STAGE_FILTERS).toEqual([
      "all",
      "Discovered",
      "Screening",
      "Qualified",
      "Outreach",
      "NDA",
      "IOI",
      "LOI",
      "Closed",
      "Passed",
    ]);
  });

  it("reads the stage from the query value, ignoring case", () => {
    expect(stageFromParam("Passed")).toBe("Passed");
    expect(stageFromParam("nda")).toBe("NDA");
    expect(stageFromParam(" loi ")).toBe("LOI");
  });

  it("shows every firm for a missing or unknown stage", () => {
    expect(stageFromParam(null)).toBe("all");
    expect(stageFromParam("")).toBe("all");
    expect(stageFromParam("Archived")).toBe("all");
  });

  it("leaves the URL bare for all and names the stage otherwise", () => {
    expect(stageToParam("all")).toBeNull();
    expect(stageToParam("Qualified")).toBe("Qualified");
  });

  it("round-trips every stage through the URL", () => {
    for (const stage of STAGE_FILTERS) {
      expect(stageFromParam(stageToParam(stage))).toBe(stage);
    }
  });
});

describe("rows and counts", () => {
  const firms = [
    firm("a", { lifecycleState: "Qualified" }),
    firm("b", { lifecycleState: "Qualified" }),
    firm("c", { lifecycleState: "NDA" }),
    firm("d", { lifecycleState: "Passed" }),
    firm("e"),
  ];

  it("counts each stage among the rows, with the total under all", () => {
    const counts = stageCounts(rows(firms));
    expect(counts.all).toBe(5);
    expect(counts.Qualified).toBe(2);
    expect(counts.NDA).toBe(1);
    expect(counts.Passed).toBe(1);
    expect(counts.Discovered).toBe(1);
    expect(counts.Closed).toBe(0);
  });

  it("keeps only the chosen stage", () => {
    const all = rows(firms);
    expect(rowsForStage(all, "Qualified").map((r) => r.firm.firmId)).toEqual(["a", "b"]);
    expect(rowsForStage(all, "Passed").map((r) => r.firm.firmId)).toEqual(["d"]);
    expect(rowsForStage(all, "all")).toHaveLength(5);
  });

  it("counts only the firms the search lets through", () => {
    const counts = stageCounts(rows(firms, "firm c"));
    expect(counts.all).toBe(1);
    expect(counts.NDA).toBe(1);
    expect(counts.Qualified).toBe(0);
  });

  it("puts the deal furthest along first", () => {
    expect(rows(firms).map((r) => r.firm.firmId)[0]).toBe("c");
  });

  it("filters on the profile fields", () => {
    const built = buildRows({
      firms: [firm("x", { ownership: "PE-backed" }), firm("y", { ownership: "Partnership" })],
      query: "",
      profile: { ...NO_PROFILE_FILTER, ownership: "PE-backed" },
      sort: DEFAULT_SORT,
      rejectByFirm: new Map(),
      activityByFirm: new Map(),
    });
    expect(built.map((r) => r.firm.firmId)).toEqual(["x"]);
  });
});

describe("activity", () => {
  it("takes the newest decision per firm", () => {
    const byFirm = lastActivityByFirm([
      { firmId: "a", decisionType: "advance", decidedAt: "2026-11-05T10:00:00Z" },
      { firmId: "a", decisionType: "enrich", decidedAt: "2026-11-01T10:00:00Z" },
      { firmId: "", decisionType: "enrich", decidedAt: "2026-11-01T10:00:00Z" },
    ]);
    expect(byFirm.size).toBe(1);
    expect(byFirm.get("a")?.type).toBe("advance");
  });

  it("puts the time first and says what happened", () => {
    expect(activityText({ type: "advance", decidedAt: NOW - 6 * HOUR }, NOW)).toBe(
      "6h ago · Advanced",
    );
    expect(activityText({ type: "acknowledge_drift", decidedAt: NOW - 1000 }, NOW)).toBe(
      "just now · Kept in pipeline",
    );
  });

  it("shows no time rather than a guessed one", () => {
    expect(activityText({ type: "enrich", decidedAt: "soon" }, NOW)).toBe("Enriched");
    expect(activityText(null, NOW)).toBe("None logged");
  });

  it("title-cases a decision type it does not know", () => {
    expect(labelForDecisionType("needs_follow-up")).toBe("Needs Follow Up");
    expect(labelForDecisionType("")).toBe("Activity");
  });
});

describe("wording", () => {
  it("says how the list is sorted", () => {
    expect(sortSummary({ key: "stage", reversed: false })).toBe("sorted by stage, then score");
    expect(sortSummary({ key: "name", reversed: true })).toBe("sorted by name (reversed)");
  });

  it("lists only the facts on file", () => {
    expect(firmFacts(firm("a"))).toEqual([]);
    expect(
      firmFacts(firm("a", { employees: 0, dealSizeMUsd: 40, firmAge: 12, ownership: "PE-backed" })),
    ).toEqual([
      { label: "Headcount", value: "0" },
      { label: "Ownership", value: "PE-backed" },
      { label: "Avg deal size", value: "$40m" },
      { label: "Firm age", value: "12 yrs" },
    ]);
  });
});
