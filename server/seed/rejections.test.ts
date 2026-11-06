import { describe, expect, it } from "vitest";
import { rng } from "../enrichment/random.js";
import { asFirmObject } from "../eval/pipeline.js";
import { REJECTION_COUNTS, planRejections } from "./rejections.js";
import { generateUniverse } from "./universe.js";

const universe = generateUniverse().map(asFirmObject);
const effects = (firms = universe) => {
  const rejected: string[] = [];
  return {
    rejected,
    fx: {
      firms: () => firms,
      record: () => {},
      reject: (f: { $primaryKey: string }) => {
        rejected.push(f.$primaryKey);
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
