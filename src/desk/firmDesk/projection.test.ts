import { describe, expect, it } from "vitest";
import { ENRICH_AXES } from "../../../shared/vocab";
import { type FindingLike } from "../axisState";
import { type ScoreInput, mirrorScore } from "../scoreMirror";
import { buildAxisRows } from "./axisRows";
import { projectProposals } from "./projection";

const CF = ENRICH_AXES.filter((a) => a.models.includes("CF"));
const base: ScoreInput = { firmType: "CF", coverageModel: "Single Coverage Focus", geoScore: 2 };

const proposed = (axis: string, value: string, over: Partial<FindingLike> = {}): FindingLike => ({
  findingId: `${axis}-${over.provider ?? "dealdb"}`,
  axis,
  value,
  provider: "dealdb",
  findingStatus: "proposed",
  ...over,
});

describe("projectProposals", () => {
  it("is null when nothing is proposed", () => {
    expect(projectProposals(base, {}, buildAxisRows(CF, undefined, []))).toBeNull();
  });

  it("scores the firm as if every proposal were accepted", () => {
    const rows = buildAxisRows(CF, undefined, [
      proposed("deal_size_usd_m", "200"),
      proposed("fee_generating_count", "6"),
    ]);
    const projection = projectProposals(base, {}, rows);
    const expected = mirrorScore({ ...base, dealSizeMUsd: 200, feeGeneratingCount: 6 });
    expect(projection).toEqual({
      score: expected.weightedTotal,
      tier: expected.tier,
      hardRejected: false,
      count: 2,
    });
    expect(projection?.score).toBeGreaterThan(mirrorScore(base).weightedTotal);
  });

  it("leaves out conflicts, abstentions and verified findings", () => {
    const rows = buildAxisRows(CF, undefined, [
      proposed("deal_size_usd_m", "200", { conflictGroupId: "g" }),
      proposed("deal_size_usd_m", "20", { conflictGroupId: "g", provider: "websearch" }),
      proposed("firm_age", "", { findingStatus: "abstained" }),
      proposed("deals_per_md_l3y", "4", { findingStatus: "verified", verifiedByHuman: true }),
    ]);
    expect(projectProposals(base, {}, rows)).toBeNull();
  });

  it("lets a value the analyst staged win over a proposal for the same axis", () => {
    const rows = buildAxisRows(CF, undefined, [proposed("fee_generating_count", "6")]);
    expect(projectProposals(base, { feeGeneratingCount: 1 }, rows)).toBeNull();
  });

  it("builds on the analyst's staged edits", () => {
    const rows = buildAxisRows(CF, undefined, [proposed("fee_generating_count", "6")]);
    const projection = projectProposals(base, { dealSizeMUsd: 200 }, rows);
    expect(projection?.score).toBe(
      mirrorScore({ ...base, dealSizeMUsd: 200, feeGeneratingCount: 6 }).weightedTotal,
    );
  });

  it("reports a proposal that would hard-reject the firm", () => {
    const rows = buildAxisRows(CF, undefined, [
      proposed("services_fit", "Conflicted: trading, lending or research"),
    ]);
    expect(projectProposals(base, {}, rows)).toMatchObject({ score: 0, hardRejected: true });
  });
});
