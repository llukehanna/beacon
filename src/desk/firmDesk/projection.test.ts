import { describe, expect, it } from "vitest";
import { ADVISORY, withTraits } from "../../../shared/rubric/__fixtures__/advisoryRubric";
import { type FindingLike } from "../axisState";
import { buildAxisRows } from "./axisRows";
import { type EditMap, type FirmView, previewScore } from "./deskModel";
import { projectProposals } from "./projection";

const base: FirmView = withTraits({
  firmType: "CF",
  coverageModel: "Single-sector focus",
  geoScore: 2,
});
const score = (edits: EditMap = {}) => previewScore(ADVISORY, base, edits);

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
    expect(
      projectProposals(ADVISORY, base, {}, buildAxisRows(ADVISORY, "CF", undefined, [])),
    ).toBeNull();
  });

  it("scores the firm as if every proposal were accepted", () => {
    const rows = buildAxisRows(ADVISORY, "CF", undefined, [
      proposed("deal_size_usd_m", "200"),
      proposed("fee_generating_count", "6"),
    ]);
    const projection = projectProposals(ADVISORY, base, {}, rows);
    const expected = score({ deal_size_usd_m: 200, fee_generating_count: 6 });
    expect(projection).toEqual({
      score: expected.weightedTotal,
      tier: expected.tier,
      hardRejected: false,
      rejectReason: "",
      count: 2,
    });
    expect(projection?.score).toBeGreaterThan(score().weightedTotal);
  });

  it("leaves out conflicts, abstentions and verified findings", () => {
    const rows = buildAxisRows(ADVISORY, "CF", undefined, [
      proposed("deal_size_usd_m", "200", { conflictGroupId: "g" }),
      proposed("deal_size_usd_m", "20", { conflictGroupId: "g", provider: "websearch" }),
      proposed("firm_age", "", { findingStatus: "abstained" }),
      proposed("deals_per_md_l3y", "4", { findingStatus: "verified", verifiedByHuman: true }),
    ]);
    expect(projectProposals(ADVISORY, base, {}, rows)).toBeNull();
  });

  it("lets a value the analyst staged win over a proposal for the same axis", () => {
    const rows = buildAxisRows(ADVISORY, "CF", undefined, [proposed("fee_generating_count", "6")]);
    expect(projectProposals(ADVISORY, base, { fee_generating_count: 1 }, rows)).toBeNull();
  });

  it("builds on the analyst's staged edits", () => {
    const rows = buildAxisRows(ADVISORY, "CF", undefined, [proposed("fee_generating_count", "6")]);
    const projection = projectProposals(ADVISORY, base, { deal_size_usd_m: 200 }, rows);
    expect(projection?.score).toBe(
      score({ deal_size_usd_m: 200, fee_generating_count: 6 }).weightedTotal,
    );
  });

  it("reports a proposal that would hard-reject the firm", () => {
    const rows = buildAxisRows(ADVISORY, "CF", undefined, [
      proposed("services_fit", "Conflicted: trading, lending or research"),
    ]);
    expect(projectProposals(ADVISORY, base, {}, rows)).toMatchObject({
      score: 0,
      hardRejected: true,
    });
  });
});
