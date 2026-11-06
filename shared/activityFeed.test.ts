import { describe, expect, it } from "vitest";
import {
  type ActivityFinding,
  type ActivityInput,
  buildActivity,
  latestRunHeadline,
} from "./activityFeed.js";

const T = Date.parse("2026-11-04T12:00:00.000Z");
const at = (hoursBefore: number) => new Date(T - hoursBefore * 3_600_000).toISOString();

const empty: ActivityInput = { firms: [], findings: [], proposedRules: [], driftEvents: [] };
const firm = (firmId: string, hoursBefore?: number) => ({
  firmId,
  firmName: `Firm ${firmId}`,
  enrichedAt: hoursBefore === undefined ? null : at(hoursBefore),
});
const finding = (patch: Partial<ActivityFinding>): ActivityFinding => ({
  firmId: "a",
  axis: "employees",
  value: "20",
  provider: "dealdb",
  findingStatus: "proposed",
  confidenceTier: "high",
  sourceQuote: "quote",
  retrievedAt: at(1),
  ...patch,
});

describe("buildActivity", () => {
  it("one enriched item per firm run with counts", () => {
    const run = at(2);
    const input: ActivityInput = {
      ...empty,
      firms: [firm("a", 2)],
      findings: [
        finding({ axis: "employees", provider: "dealdb", retrievedAt: run }),
        finding({ axis: "firm_age", provider: "filings", retrievedAt: run, sourceQuote: "" }),
        finding({ axis: "deal_size", provider: "dealdb+websearch", retrievedAt: run }),
        // a second run of the same firm is its own item
        finding({ axis: "employees", provider: "websearch", retrievedAt: at(20) }),
        // another firm's finding at the same instant is not this firm's run
        finding({ firmId: "b", retrievedAt: run }),
        // an analyst's own entry is not an agent run
        finding({ provider: "analyst", retrievedAt: at(0.5) }),
      ],
    };
    const enriched = buildActivity(input).filter((i) => i.kind === "enriched" && i.firmId === "a");
    expect(enriched.map((i) => [i.at, i.detail])).toEqual([
      [run, "3 sources · 2 grounded · 0 conflicts"],
      [at(20), "1 source · 1 grounded · 0 conflicts"],
    ]);
    expect(enriched[0].title).toBe("Firm a enriched");
  });

  it("names the axis and both values of an open conflict", () => {
    const input: ActivityInput = {
      ...empty,
      firms: [firm("a", 1)],
      findings: [
        finding({ conflictGroupId: "g1", provider: "dealdb", value: "20", retrievedAt: at(1) }),
        finding({ conflictGroupId: "g1", provider: "filings", value: "35", retrievedAt: at(1) }),
        // a resolved group is not open
        finding({ axis: "firm_age", conflictGroupId: "g2", findingStatus: "verified" }),
        finding({ axis: "firm_age", conflictGroupId: "g2", findingStatus: "rejected" }),
      ],
    };
    const items = buildActivity(input);
    expect(items.find((i) => i.kind === "enriched")?.detail).toMatch(/· 2 conflicts$/);
    const conflict = items.filter((i) => i.kind === "conflict");
    expect(conflict).toHaveLength(1);
    expect(conflict[0].detail).toBe("Employees: Deal DB 20 vs Filings 35");
  });

  it("names the axes an agent abstained on, unless something later settled them", () => {
    const input: ActivityInput = {
      ...empty,
      firms: [firm("a", 1)],
      findings: [
        finding({ axis: "employees", confidenceTier: "abstain", sourceQuote: null }),
        finding({ axis: "firm_age", findingStatus: "abstained", confidenceTier: "abstain" }),
        // settled by an analyst
        finding({ axis: "deal_size", confidenceTier: "abstain" }),
        finding({ axis: "deal_size", findingStatus: "verified", provider: "analyst" }),
        // replaced by a later run
        finding({ axis: "geo", confidenceTier: "abstain", findingStatus: "superseded" }),
      ],
    };
    const abstained = buildActivity(input).filter((i) => i.kind === "abstained");
    expect(abstained).toHaveLength(1);
    expect(abstained[0].detail).toBe("No source had Employees, Firm age");
  });

  it("describes rule proposals and drift events", () => {
    const input: ActivityInput = {
      ...empty,
      firms: [firm("a")],
      proposedRules: [
        { proposedRuleId: "r1", text: "employees < 10", proposedAt: at(3), supportingFirmCount: 4 },
        // no recorded time: it cannot be placed in a timeline
        { proposedRuleId: "r2", text: "firm age < 3", proposedAt: null, supportingFirmCount: 3 },
      ],
      driftEvents: [
        { driftEventId: "d1", firmId: "a", detectedAt: at(4), reason: "tier_moved" },
        { driftEventId: "d2", firmId: "a", detectedAt: null, reason: "tier_moved" },
      ],
    };
    const items = buildActivity(input);
    expect(items.map((i) => [i.kind, i.title, i.detail])).toEqual([
      ["rule_proposed", "Rule proposed: employees < 10", "Supported by 4 firms"],
      ["drift", "Firm a: drift detected", "Tier moved"],
    ]);
  });

  it("orders newest first with stable ties", () => {
    const same = at(1);
    const input: ActivityInput = {
      firms: [firm("b", 1), firm("a", 1)],
      findings: [
        finding({ firmId: "b", retrievedAt: same }),
        finding({ firmId: "a", retrievedAt: same }),
        finding({ firmId: "a", axis: "firm_age", confidenceTier: "abstain", retrievedAt: same }),
        finding({ firmId: "a", axis: "geo", conflictGroupId: "g", retrievedAt: same }),
        finding({ firmId: "a", axis: "geo", conflictGroupId: "g", retrievedAt: same, value: "9" }),
        finding({ firmId: "b", retrievedAt: at(9) }),
      ],
      proposedRules: [{ proposedRuleId: "r", text: "x", proposedAt: same, supportingFirmCount: 3 }],
      driftEvents: [{ driftEventId: "d", firmId: "a", detectedAt: same, reason: "tier_moved" }],
    };
    const items = buildActivity(input, 20);
    expect(items.map((i) => `${i.kind}:${i.firmId}:${i.at === same ? "same" : "old"}`)).toEqual([
      "enriched:a:same",
      "enriched:b:same",
      "conflict:a:same",
      "abstained:a:same",
      "rule_proposed:null:same",
      "drift:a:same",
      "enriched:b:old",
    ]);
    expect(buildActivity(input, 20)).toEqual(items);
  });

  it("limits to 7", () => {
    const firms = Array.from({ length: 12 }, (_, i) => firm(`f${String(i).padStart(2, "0")}`, i));
    const findings = firms.map((f, i) => finding({ firmId: f.firmId, retrievedAt: at(i) }));
    const items = buildActivity({ ...empty, firms, findings });
    expect(items).toHaveLength(7);
    expect(items[0].firmId).toBe("f00");
    expect(buildActivity({ ...empty, firms, findings }, 3)).toHaveLength(3);
  });
});

describe("latestRunHeadline", () => {
  it("counts firms enriched within 24h of the latest run", () => {
    const input: ActivityInput = {
      ...empty,
      firms: [firm("a", 0), firm("b", 2), firm("c", 30)],
    };
    expect(latestRunHeadline(input)).toEqual({
      enrichedFirms: 2,
      abstainedAxes: 0,
      windowHours: 24,
    });
  });

  it("counts the axes the window's runs left abstained", () => {
    const input: ActivityInput = {
      ...empty,
      firms: [firm("a", 0), firm("b", 30)],
      findings: [
        finding({ axis: "employees", confidenceTier: "abstain", retrievedAt: at(1) }),
        finding({ axis: "firm_age", confidenceTier: "abstain", retrievedAt: at(1) }),
        // the same axis abstained twice counts once
        finding({ axis: "firm_age", confidenceTier: "abstain", retrievedAt: at(2) }),
        // outside the window
        finding({ axis: "geo", confidenceTier: "abstain", retrievedAt: at(40) }),
        // settled since
        finding({ axis: "deal_size", confidenceTier: "abstain", retrievedAt: at(1) }),
        finding({ axis: "deal_size", findingStatus: "verified", retrievedAt: at(0.5) }),
      ],
    };
    expect(latestRunHeadline(input)?.abstainedAxes).toBe(2);
  });

  it("returns null when nothing was enriched", () => {
    expect(latestRunHeadline({ ...empty, firms: [firm("a"), firm("b")] })).toBeNull();
    expect(latestRunHeadline(empty)).toBeNull();
  });
});
