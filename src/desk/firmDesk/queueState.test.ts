import { describe, expect, it } from "vitest";
import { agoText, findingCountsByFirm, queueStateLine } from "./queueState";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

let n = 0;
const finding = (over: Record<string, unknown>) => ({
  findingId: `f${++n}`,
  firmId: "a",
  findingStatus: "proposed",
  retrievedAt: "2026-11-05T10:00:00.000Z",
  ...over,
});

describe("findingCountsByFirm", () => {
  it("counts a conflict once, however many sides it has", () => {
    const counts = findingCountsByFirm([
      finding({ axis: "deals_per_md", conflictGroupId: "g1", value: "6.1" }),
      finding({ axis: "deals_per_md", conflictGroupId: "g1", value: "4.5" }),
    ]);
    expect(counts.get("a")).toEqual({ conflicts: 1, proposed: 0, abstained: 0 });
  });

  it("drops a conflict once a side is verified and the other rejected", () => {
    const counts = findingCountsByFirm([
      finding({ axis: "x", conflictGroupId: "g1", findingStatus: "verified" }),
      finding({ axis: "x", conflictGroupId: "g1", findingStatus: "rejected" }),
    ]);
    expect(counts.has("a")).toBe(false);
  });

  it("counts proposed and abstained axes by their authoritative finding", () => {
    const counts = findingCountsByFirm([
      finding({ axis: "services_fit" }),
      finding({ axis: "md_pedigree", confidenceTier: "abstain", findingStatus: "abstained" }),
      // Verified beats the later proposal: this axis is settled.
      finding({ axis: "firm_age", findingStatus: "verified", verifiedByHuman: true }),
      finding({ axis: "firm_age", retrievedAt: "2026-11-05T11:00:00.000Z" }),
      finding({ axis: "employees", findingStatus: "superseded" }),
    ]);
    expect(counts.get("a")).toEqual({ conflicts: 0, proposed: 1, abstained: 1 });
  });

  it("keeps firms apart", () => {
    const counts = findingCountsByFirm([
      finding({ axis: "services_fit" }),
      finding({ axis: "services_fit", firmId: "b" }),
      finding({ axis: "md_pedigree", firmId: "b" }),
    ]);
    expect(counts.get("a")?.proposed).toBe(1);
    expect(counts.get("b")?.proposed).toBe(2);
  });
});

describe("agoText", () => {
  it("reads like a sentence ending", () => {
    expect(agoText(minutesAgo(2), NOW)).toBe("2m ago");
    expect(agoText(new Date(NOW - 10_000).toISOString(), NOW)).toBe("just now");
    expect(agoText(null, NOW)).toBeNull();
    expect(agoText("not a date", NOW)).toBeNull();
  });
});

describe("queueStateLine", () => {
  const base = { agent: "agent", now: NOW, enrichedBy: "agent" };

  it("says a firm has not been enriched when it has no run time", () => {
    expect(queueStateLine({ ...base, enrichedAt: null, counts: undefined })).toBe(
      "Not yet enriched",
    );
  });

  it("puts the agent's run time first and the most pressing finding count after it", () => {
    const counts = { conflicts: 1, proposed: 3, abstained: 2 };
    expect(queueStateLine({ ...base, enrichedAt: minutesAgo(2), counts })).toBe(
      "Agent ran 2m ago · 1 conflict",
    );
    expect(
      queueStateLine({ ...base, enrichedAt: minutesAgo(2), counts: { ...counts, conflicts: 0 } }),
    ).toBe("Agent ran 2m ago · 3 proposed");
    expect(
      queueStateLine({
        ...base,
        enrichedAt: minutesAgo(2),
        counts: { conflicts: 0, proposed: 0, abstained: 2 },
      }),
    ).toBe("Agent ran 2m ago · 2 axes without a source");
  });

  it("does not credit the agent for an analyst's enrichment", () => {
    expect(
      queueStateLine({
        ...base,
        enrichedBy: "analyst",
        enrichedAt: minutesAgo(5),
        counts: undefined,
      }),
    ).toBe("Enriched 5m ago");
  });
});
