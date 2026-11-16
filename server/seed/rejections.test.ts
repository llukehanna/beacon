import { describe, expect, it } from "vitest";
import { CANDIDATES } from "../clustering/heuristic.js";
import { rng } from "../enrichment/random.js";
import { asFirmObject } from "../eval/pipeline.js";
import { REJECTION_COUNTS, REJECTION_NOTES, planRejections } from "./rejections.js";
import { generateUniverse } from "./universe.js";

const universe = generateUniverse().map(asFirmObject);
const effects = (firms = universe) => {
  const rejected: string[] = [];
  const notes: string[] = [];
  return {
    rejected,
    notes,
    fx: {
      firms: () => firms,
      record: () => {},
      reject: (f: { $primaryKey: string }, why: string) => {
        rejected.push(f.$primaryKey);
        notes.push(why);
      },
      draw: rng("t"),
    },
  };
};

describe("planRejections", () => {
  it("rejects each firm once, the seed's number per pattern", async () => {
    const { rejected, fx } = effects();
    const { patterns, noise } = await planRejections(fx, new Set());
    expect(new Set(rejected).size).toBe(rejected.length);
    expect(patterns.map((p) => p.firmIds.length)).toEqual([
      REJECTION_COUNTS.small,
      REJECTION_COUNTS.generalist,
      REJECTION_COUNTS.dealSize,
      REJECTION_COUNTS.dealVolume,
    ]);
    expect(noise).toHaveLength(REJECTION_COUNTS.misc);
  });

  it("passes over firms already taken and firms no longer being looked at", async () => {
    const first = await planRejections(effects().fx, new Set());
    const skipped = first.patterns[0].firmIds.slice(0, 2);
    const moved = universe.map((f) =>
      first.patterns[0].firmIds[2] === f.$primaryKey ? { ...f, lifecycleState: "Passed" } : f,
    );
    const again = await planRejections(effects(moved).fx, new Set(skipped));
    const small = again.patterns[0].firmIds;
    expect(small.some((id) => skipped.includes(id))).toBe(false);
    expect(small).not.toContain(first.patterns[0].firmIds[2]);
  });
});

describe("rejection notes", () => {
  it("never gives two firms the same note", async () => {
    const { notes, fx } = effects();
    await planRejections(fx, new Set());
    expect(notes).toHaveLength(Object.values(REJECTION_COUNTS).reduce((a, b) => a + b, 0));
    expect(new Set(notes).size).toBe(notes.length);
  });

  it("has a wording for every firm rejected for each reason", () => {
    for (const [key, count] of Object.entries(REJECTION_COUNTS)) {
      const notes = REJECTION_NOTES[key as keyof typeof REJECTION_NOTES];
      expect(notes.length, key).toBeGreaterThanOrEqual(count);
    }
  });

  it("names its reason in the clustering heuristic's words, and noise names none", () => {
    const text = (note: string | ((n: number) => string)): string =>
      typeof note === "string" ? note : note(5);
    const own = {
      small: "employees",
      generalist: "coverage_model",
      dealSize: "deal_size_usd_m",
      dealVolume: "deals_per_md_l3y",
    } as const;
    for (const [key, axis] of Object.entries(own)) {
      const keywords = CANDIDATES.find((c) => c.axis === axis)!.keywords;
      for (const note of REJECTION_NOTES[key as keyof typeof own]) {
        expect(keywords.test(text(note)), text(note)).toBe(true);
      }
    }
    for (const note of REJECTION_NOTES.misc) {
      for (const c of CANDIDATES) {
        expect(c.keywords.test(note), `${note} / ${c.axis}`).toBe(false);
      }
    }
  });
});
