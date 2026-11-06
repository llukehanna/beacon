import { describe, expect, it } from "vitest";
import type { FirmLike } from "./exportRows.js";
import {
  APPROVED_CAP,
  DEFAULT_K,
  lookalikes,
  lookalikesOfApproved,
  moreLikeThis,
} from "./lookalikes.js";

const firm = (id: string, over: Partial<FirmLike> = {}): FirmLike => ({
  firmId: id,
  firmName: `Firm ${id}`,
  firmType: "CF",
  sector: "Healthcare Services",
  coverageModel: "Single-sector focus",
  hqCountry: "United Kingdom",
  revenueBand: "$10–25M",
  ownership: "Partnership",
  successionRisk: "Low",
  dealSizeMUsd: 45,
  dealsPerMdL3y: 2.4,
  lifecycleState: "Screening",
  ...over,
});

/** A firm that shares no profile field with `firm()` (and has no deal numbers within 10%). */
const unlike = (id: string, over: Partial<FirmLike> = {}): FirmLike =>
  firm(id, {
    firmType: "CS",
    sector: "Software",
    coverageModel: "Generalist",
    hqCountry: "Japan",
    revenueBand: ">$100M",
    ownership: "PE-backed",
    successionRisk: "High",
    dealSizeMUsd: 300,
    dealsPerMdL3y: 9,
    ...over,
  });

describe("lookalikes", () => {
  it("scores an identical firm highest, at 100, and cites every field", () => {
    const target = firm("t");
    const out = lookalikes(target, [
      unlike("u"),
      firm("twin"),
      firm("half", { sector: "Software" }),
    ]);
    expect(out[0]).toMatchObject({ firmId: "twin", score: 100 });
    expect(out[0].reasons).toEqual([
      "Same sub-sector: Healthcare Services",
      "Same coverage model: Single-sector focus",
      "Same model: Corporate finance",
      "Same HQ country: United Kingdom",
      "Same revenue band: $10–25M",
      "Same ownership: Partnership",
      "Same succession risk: Low",
      "Deal size within 10%: $45m vs $45m",
      "Deal velocity within 10%: 2.4 deals per MD vs 2.4 deals per MD",
    ]);
    expect(out.map((l) => l.firmId)).toEqual(["twin", "half"]);
    expect(out[1].score).toBeLessThan(out[0].score);
  });

  it("never includes the target, even when the universe holds it", () => {
    const target = firm("t");
    expect(lookalikes(target, [target, firm("a")]).map((l) => l.firmId)).toEqual(["a"]);
  });

  it("cites only fields that matched, with the matched values", () => {
    const target = firm("t");
    const [hit] = lookalikes(target, [
      unlike("c", { sector: "Healthcare Services", dealSizeMUsd: 48, dealsPerMdL3y: 2.5 }),
    ]);
    expect(hit.reasons).toEqual([
      "Same sub-sector: Healthcare Services",
      "Deal size within 10%: $45m vs $48m",
      "Deal velocity within 10%: 2.4 deals per MD vs 2.5 deals per MD",
    ]);
    // 6 + 4 + 4 of the target's 33 points.
    expect(hit.score).toBe(Math.round((100 * 14) / 33));
  });

  it("matches numbers within 10% of the larger, inclusive, and no further", () => {
    const target = firm("t", { dealSizeMUsd: 100, dealsPerMdL3y: null });
    const edge = unlike("edge", { dealSizeMUsd: 90 });
    const over = unlike("over", { dealSizeMUsd: 89 });
    const out = lookalikes(target, [edge, over]);
    expect(out.map((l) => l.firmId)).toEqual(["edge"]);
    expect(out[0].reasons).toEqual(["Deal size within 10%: $100m vs $90m"]);
  });

  it("does not compare a field either side leaves empty", () => {
    const target = firm("t", { sector: null, revenueBand: "  " });
    const blank = unlike("b", { sector: null, revenueBand: "", dealSizeMUsd: null });
    expect(lookalikes(target, [blank])).toEqual([]);
    // The target's empty fields do not count against the score either.
    const [hit] = lookalikes(target, [firm("twin", { sector: "Software" })]);
    expect(hit.score).toBe(100);
    expect(hit.reasons.join()).not.toContain("sub-sector");
  });

  it("ignores case and spacing when comparing text, and shows the candidate's value", () => {
    const [hit] = lookalikes(firm("t"), [unlike("c", { ownership: "  partnership " })]);
    expect(hit.reasons).toEqual(["Same ownership: partnership"]);
  });

  it("returns nothing for a firm without a single comparable field, or for k of 0", () => {
    expect(lookalikes({ firmId: "t" }, [firm("a")])).toEqual([]);
    expect(lookalikes(firm("t"), [firm("a")], 0)).toEqual([]);
  });

  it("drops a firm that matches on nothing", () => {
    expect(lookalikes(firm("t"), [unlike("u")])).toEqual([]);
  });

  it("returns the k best by default 5, best first", () => {
    const universe = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? firm(`m${String(i).padStart(2, "0")}`) : firm(`n${i}`, { sector: "Software" }),
    );
    const out = lookalikes(firm("t"), universe);
    expect(DEFAULT_K).toBe(5);
    expect(out).toHaveLength(5);
    expect(out.every((l) => l.score === 100)).toBe(true);
    expect(lookalikes(firm("t"), universe, 8)).toHaveLength(8);
  });

  it("breaks ties by firm id, whatever order the universe arrives in", () => {
    const ids = ["d", "b", "e", "a", "c"];
    const forward = lookalikes(
      firm("t"),
      ids.map((i) => firm(i)),
    );
    const backward = lookalikes(
      firm("t"),
      [...ids].reverse().map((i) => firm(i)),
    );
    expect(forward.map((l) => l.firmId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(backward).toEqual(forward);
    // The cut at k is by the same order.
    expect(
      lookalikes(
        firm("t"),
        ids.map((i) => firm(i)),
        2,
      ).map((l) => l.firmId),
    ).toEqual(["a", "b"]);
  });

  it("stays quick over a 700-firm universe", () => {
    const sectors = ["Software", "Healthcare Services", "Energy", "Retail"];
    const universe = Array.from({ length: 700 }, (_, i) =>
      firm(`f${String(i).padStart(3, "0")}`, {
        sector: sectors[i % 4],
        dealSizeMUsd: 20 + (i % 50),
      }),
    );
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) {
      lookalikes(universe[i], universe);
    }
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("moreLikeThis", () => {
  it("lists passed firms, flagged, instead of hiding them", () => {
    const firms = [
      firm("t"),
      firm("hard", { lifecycleState: "Passed" }),
      firm("legacy", { lifecycleState: "rejected" }),
      firm("open"),
    ];
    const rows = moreLikeThis("t", firms);
    expect(rows.map((r) => r.firmId)).toEqual(["hard", "legacy", "open"]);
    expect(rows.map((r) => r.passed)).toEqual([true, true, false]);
    expect(rows.map((r) => r.stage)).toEqual(["Passed", "Passed", "Screening"]);
  });

  it("carries the name and tier, and reasons from the record", () => {
    const [row] = moreLikeThis("t", [firm("t"), firm("a", { firmName: "Anchor Partners" })]);
    expect(row.name).toBe("Anchor Partners");
    expect(["A", "B", "C", "Rejected"]).toContain(row.tier);
    expect(row.reasons[0]).toBe("Same sub-sector: Healthcare Services");
  });

  it("is empty for an unknown firm", () => {
    expect(moreLikeThis("nope", [firm("a")])).toEqual([]);
  });
});

describe("lookalikesOfApproved", () => {
  const universe = [
    firm("q1", { lifecycleState: "Qualified" }),
    firm("q2", { lifecycleState: "NDA", sector: "Software", hqCountry: "Japan" }),
    firm("a", { sector: "Software", hqCountry: "Japan" }),
    firm("b"),
    unlike("far", { sector: "Energy", hqCountry: "Brazil" }),
  ];
  const approved = [universe[0], universe[1]];

  it("unions the targets' lookalikes, leaves out the approved firms and keeps each firm's best score", () => {
    const out = lookalikesOfApproved(approved, universe);
    expect(out.map((r) => r.firmId)).not.toContain("q1");
    expect(out.map((r) => r.firmId)).not.toContain("q2");
    expect(out.map((r) => r.firmId).sort()).toEqual(["a", "b"]);
    expect(new Set(out.map((r) => r.firmId)).size).toBe(out.length);

    // "b" is a twin of q1 and only partly like q2: it keeps the better score and says why.
    const b = out.find((r) => r.firmId === "b")!;
    expect(b.score).toBe(100);
    expect(b.basedOn).toEqual({ firmId: "q1", name: "Firm q1" });
    // "a" is a twin of q2 (both Software, Japan) apart from its other fields.
    const a = out.find((r) => r.firmId === "a")!;
    expect(a.basedOn.firmId).toBe("q2");
    expect(a.score).toBe(100);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });

  it("caps the list at 20", () => {
    const many = Array.from({ length: 60 }, (_, i) => firm(`x${String(i).padStart(2, "0")}`));
    const out = lookalikesOfApproved(
      [firm("q", { lifecycleState: "Qualified" })],
      [firm("q", { lifecycleState: "Qualified" }), ...many],
    );
    expect(APPROVED_CAP).toBe(20);
    expect(out).toHaveLength(20);
    expect(out.map((r) => r.firmId)).toEqual(many.slice(0, 20).map((f) => f.firmId));
  });

  it("is empty with no approved targets", () => {
    expect(lookalikesOfApproved([], universe)).toEqual([]);
  });

  it("flags a passed lookalike instead of dropping it", () => {
    const out = lookalikesOfApproved(
      [firm("q", { lifecycleState: "Qualified" })],
      [firm("q", { lifecycleState: "Qualified" }), firm("p", { lifecycleState: "Passed" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ firmId: "p", passed: true, stage: "Passed" });
  });

  it("breaks a tie between targets by the lower firm id", () => {
    const out = lookalikesOfApproved(
      [firm("q9", { lifecycleState: "Qualified" }), firm("q2", { lifecycleState: "Qualified" })],
      [
        firm("q9", { lifecycleState: "Qualified" }),
        firm("q2", { lifecycleState: "Qualified" }),
        firm("z"),
      ],
    );
    expect(out[0].basedOn.firmId).toBe("q2");
  });
});
