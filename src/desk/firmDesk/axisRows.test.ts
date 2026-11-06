import { describe, expect, it } from "vitest";
import type { FirmObservations, ProviderObservation } from "../../../shared/summaries";
import { ENRICH_AXES, PROVIDER_TRUST } from "../../../shared/vocab";
import { type FindingLike } from "../axisState";
import {
  authoritativeFinding,
  buildAxisRows,
  openConflictFindings,
  summarizeRows,
  summaryText,
} from "./axisRows";

const CF_AXES = ENRICH_AXES.filter((a) => a.models.includes("CF"));

const nothing = (provider: string): ProviderObservation => ({
  provider,
  value: null,
  confidence: null,
  grounded: null,
  rejectReason: null,
  quote: null,
  documentId: null,
  checks: null,
});

const said = (
  provider: string,
  value: string,
  confidence: "high" | "low",
): ProviderObservation => ({
  provider,
  value,
  confidence,
  grounded: true,
  rejectReason: null,
  quote: `The firm reports ${value} in total.`,
  documentId: `${provider}:f1`,
  checks: { line: 2, valueInQuote: true, words: 6 },
});

function obs(overrides: Record<string, Record<string, ProviderObservation>>): FirmObservations {
  return {
    firmId: "f1",
    model: "rule-based",
    hitsByProvider: {},
    axes: CF_AXES.map((a) => ({
      axis: a.axis,
      providers: PROVIDER_TRUST.map((p) => overrides[a.axis]?.[p] ?? nothing(p)),
    })),
  };
}

const finding = (over: Partial<FindingLike>): FindingLike => ({
  findingId: `fd-${Math.random()}`,
  axis: "fee_generating_count",
  value: "12",
  provider: "dealdb",
  confidenceTier: "high",
  findingStatus: "proposed",
  ...over,
});

describe("buildAxisRows", () => {
  it("gives one row per axis in rubric order", () => {
    const rows = buildAxisRows(CF_AXES, obs({}), []);
    expect(rows.map((r) => r.axis)).toEqual(CF_AXES.map((a) => a.axis));
    expect(rows.every((r) => r.state === "empty")).toBe(true);
  });

  it("weights scored axes by their share of the rubric and marks gates", () => {
    const rows = buildAxisRows(CF_AXES, undefined, []);
    expect(rows.find((r) => r.axis === "fee_generating_count")?.weight).toBe("×1");
    expect(rows.find((r) => r.axis === "solvent")?.weight).toBe("gate");
  });

  it("fills cells from observations and leaves null where a provider had nothing", () => {
    const rows = buildAxisRows(
      CF_AXES,
      obs({ fee_generating_count: { dealdb: said("dealdb", "12", "high") } }),
      [],
    );
    const fee = rows.find((r) => r.axis === "fee_generating_count");
    expect(fee?.cells.dealdb).toEqual({ value: "12", confidence: "high" });
    expect(fee?.cells.beacondb).toEqual({ value: null, confidence: null });
    expect(Object.keys(fee?.cells ?? {})).toEqual([...PROVIDER_TRUST]);
  });

  it("shows gate values as Pass or Fail", () => {
    const rows = buildAxisRows(
      CF_AXES,
      obs({ solvent: { filings: said("filings", "true", "high") } }),
      [],
    );
    expect(rows.find((r) => r.axis === "solvent")?.cells.filings.value).toBe("Pass");
  });

  it("keeps a reading grounding turned down out of the cells and lists it as a rejection", () => {
    const rejected: ProviderObservation = {
      ...nothing("websearch"),
      value: "99",
      grounded: false,
      rejectReason: "value_not_in_quote",
      quote: "A short line",
    };
    const rows = buildAxisRows(CF_AXES, obs({ firm_age: { websearch: rejected } }), []);
    const age = rows.find((r) => r.axis === "firm_age");
    expect(age?.cells.websearch.value).toBeNull();
    expect(age?.rejections).toEqual([
      { provider: "websearch", value: "99", reason: "value_not_in_quote" },
    ]);
  });

  it("copes with observations that have not loaded yet", () => {
    const rows = buildAxisRows(CF_AXES, undefined, []);
    expect(rows).toHaveLength(CF_AXES.length);
    for (const row of rows) {
      expect(Object.values(row.cells).every((c) => c.value === null && c.confidence === null)).toBe(
        true,
      );
    }
  });

  it("routes findings to their axis through the finding vocabulary aliases", () => {
    const f = finding({ axis: "deal_size", value: "40" });
    const rows = buildAxisRows(CF_AXES, undefined, [f]);
    expect(rows.find((r) => r.axis === "deal_size_usd_m")?.findings).toEqual([f]);
  });

  it("ignores superseded findings", () => {
    const rows = buildAxisRows(CF_AXES, undefined, [finding({ findingStatus: "superseded" })]);
    expect(rows.find((r) => r.axis === "fee_generating_count")?.state).toBe("empty");
  });

  describe("state", () => {
    const state = (fs: FindingLike[]) =>
      buildAxisRows(CF_AXES, undefined, fs).find((r) => r.axis === "fee_generating_count")?.state;

    it("is conflict when two sources disagree and neither is resolved", () => {
      expect(
        state([
          finding({ findingId: "a", provider: "dealdb", value: "12", conflictGroupId: "g1" }),
          finding({ findingId: "b", provider: "websearch", value: "9", conflictGroupId: "g1" }),
        ]),
      ).toBe("conflict");
    });

    it("is verified once a conflict is resolved", () => {
      expect(
        state([
          finding({
            findingId: "a",
            conflictGroupId: "g1",
            findingStatus: "verified",
            verifiedByHuman: true,
          }),
          finding({ findingId: "b", conflictGroupId: "g1", findingStatus: "rejected" }),
        ]),
      ).toBe("verified");
    });

    it("is abstained when only an abstain finding exists", () => {
      expect(
        state([
          finding({ findingStatus: "abstained", confidenceTier: "abstain", value: undefined }),
        ]),
      ).toBe("abstained");
    });

    it("is proposed for an unverified agent value and verified once a human confirmed it", () => {
      expect(state([finding({})])).toBe("proposed");
      expect(state([finding({ findingStatus: "verified", verifiedByHuman: true })])).toBe(
        "verified",
      );
    });

    it("is rejected when every finding was turned down", () => {
      expect(state([finding({ findingStatus: "rejected" })])).toBe("rejected");
    });

    it("lets a conflict outrank the rest", () => {
      expect(
        state([
          finding({ findingId: "v", findingStatus: "verified", verifiedByHuman: true }),
          finding({ findingId: "a", conflictGroupId: "g2" }),
          finding({ findingId: "b", conflictGroupId: "g2", provider: "filings" }),
        ]),
      ).toBe("conflict");
    });
  });
});

describe("row findings", () => {
  const a = finding({ findingId: "a", provider: "dealdb", value: "12", conflictGroupId: "g" });
  const b = finding({ findingId: "b", provider: "websearch", value: "9", conflictGroupId: "g" });
  const rows = buildAxisRows(CF_AXES, undefined, [a, b]);
  const row = rows.find((r) => r.axis === "fee_generating_count");

  it("lists the two sides of an open conflict", () => {
    expect(row && openConflictFindings(row).map((f) => f.findingId)).toEqual(["a", "b"]);
  });

  it("has no authoritative finding while a conflict is open", () => {
    expect(row && authoritativeFinding(row)).toBeUndefined();
  });

  it("picks the human-verified finding as authoritative", () => {
    const verified = finding({ findingId: "v", findingStatus: "verified", verifiedByHuman: true });
    const proposed = finding({ findingId: "p" });
    const r = buildAxisRows(CF_AXES, undefined, [proposed, verified]).find(
      (x) => x.axis === "fee_generating_count",
    );
    expect(r && authoritativeFinding(r)?.findingId).toBe("v");
  });
});

describe("summarizeRows", () => {
  it("counts rows by state, with one conflict per axis", () => {
    const rows = buildAxisRows(CF_AXES, undefined, [
      finding({ findingId: "a", conflictGroupId: "g" }),
      finding({ findingId: "b", conflictGroupId: "g", provider: "filings" }),
      finding({ findingId: "c", axis: "firm_age" }),
      finding({
        findingId: "d",
        axis: "solvent",
        findingStatus: "verified",
        verifiedByHuman: true,
      }),
      finding({ findingId: "e", axis: "web_activity", findingStatus: "abstained" }),
    ]);
    expect(summarizeRows(rows)).toEqual({ conflicts: 1, proposed: 1, abstained: 1, verified: 1 });
  });
});

describe("summaryText", () => {
  it("reads as one line and pluralises conflicts", () => {
    expect(summaryText({ conflicts: 1, proposed: 3, abstained: 2, verified: 0 })).toBe(
      "1 conflict · 3 proposed · 2 abstained · 0 verified",
    );
    expect(summaryText({ conflicts: 2, proposed: 0, abstained: 0, verified: 1 })).toMatch(
      /^2 conflicts · /,
    );
  });
});

describe("an axis a market signal alone has spoken for", () => {
  const def = ENRICH_AXES.find((a) => a.axis === "fee_generating_count")!;
  const signal: FindingLike = {
    findingId: "s1",
    axis: "fee_generating_count",
    value: "3",
    provider: "market_signal",
    findingStatus: "signal",
    retrievedAt: "2026-06-01T00:00:00Z",
  };

  it("is the signal state, not verified", () => {
    const [row] = buildAxisRows([def], undefined, [signal]);
    expect(row.state).toBe("signal");
    expect(authoritativeFinding(row)?.findingId).toBe("s1");
  });

  it("gives way to a human-verified finding", () => {
    const mine: FindingLike = {
      ...signal,
      findingId: "m1",
      provider: "analyst",
      findingStatus: "verified",
      verifiedByHuman: true,
      value: "4",
    };
    const [row] = buildAxisRows([def], undefined, [signal, mine]);
    expect(row.state).toBe("verified");
    expect(authoritativeFinding(row)?.findingId).toBe("m1");
  });
});
