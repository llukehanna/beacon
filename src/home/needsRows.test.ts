import { describe, expect, it } from "vitest";
import type { NeedsYouItem } from "../../shared/summaries";
import { needsRow } from "./needsRows";

const drift = (patch: Partial<Extract<NeedsYouItem, { kind: "drift" }>>): NeedsYouItem => ({
  kind: "drift",
  key: "drift:1",
  rank: 2,
  destination: "review",
  name: "Alpha Advisors",
  at: "2026-11-05T10:00:00.000Z",
  ...patch,
});

describe("needsRow", () => {
  it("marks a tier that moved down in red with both tiers and scores", () => {
    const row = needsRow(
      drift({
        driftReason: "tier_moved",
        priorTier: "A",
        priorScore: 14,
        newTier: "B",
        newScore: 11,
      }),
    );
    expect(row).toMatchObject({
      mark: "↓",
      tone: "down",
      to: "/review",
      figure: { from: "A 14", to: "B 11" },
      at: "2026-11-05T10:00:00.000Z",
    });
  });

  it("marks a tier that moved up", () => {
    const row = needsRow(
      drift({
        driftReason: "tier_moved",
        priorTier: "C",
        priorScore: 8,
        newTier: "B",
        newScore: 11,
      }),
    );
    expect(row).toMatchObject({ mark: "↑", tone: "up" });
  });

  it("falls back to tier letters when scores are missing", () => {
    expect(
      needsRow(drift({ driftReason: "tier_moved", priorTier: "A", newTier: "C" })),
    ).toMatchObject({ tone: "down", figure: { from: "A", to: "C" } });
  });

  it("marks an invalidated pass reason amber", () => {
    expect(needsRow(drift({ driftReason: "pass_reason_invalidated" }))).toMatchObject({
      mark: "!",
      tone: "attention",
      reason: "the reason we passed no longer holds",
    });
  });

  it("sends a judgment row to the firm on the desk", () => {
    const row = needsRow({
      kind: "judgment",
      key: "firm:f 1",
      rank: 3,
      destination: "desk",
      firmId: "f 1",
      name: "Bellhaven Talbot Group",
      axes: 4,
      at: null,
    });
    expect(row).toMatchObject({
      mark: "?",
      tone: "judgment",
      to: "/desk?firmId=f%201",
      reason: "4 axes had no source, needs judgment",
      figure: { text: "4 open" },
      at: null,
    });
  });

  it("says nothing about a rule whose projection is not computed", () => {
    const rule = {
      kind: "rule" as const,
      key: "rule:r",
      rank: 4 as const,
      destination: "rules" as const,
      proposedRuleId: "r",
      name: "employees < 10",
      at: null,
    };
    expect(needsRow({ ...rule, screens: null }).figure).toBeNull();
    expect(needsRow({ ...rule, screens: 12 }).figure).toEqual({ text: "screens 12" });
  });
});
