/**
 * The rejections the seed plants for the learning loop to find: how many of each kind, the words
 * the analyst gives, and the values it records. Pure, so the seed and the evaluation plant the
 * same patterns from the same definitions.
 */
import type { ObjectOf } from "../../shared/schema.js";
import { normalizeLifecycle } from "../../shared/vocab.js";
import { sortedRows } from "../db/ordering.js";
import type { Rng } from "../enrichment/random.js";

/** Rejections the seed makes per pattern; `misc` is noise no hard-screen rule can express. */
export const REJECTION_COUNTS = {
  small: 7,
  generalist: 5,
  dealSize: 5,
  dealVolume: 4,
  misc: 4,
} as const;

/**
 * The analyst's notes, several wordings per reason: the n-th firm rejected for a reason gets the
 * n-th wording, so no two firms carry the same note. Each still names its reason in words the
 * clustering heuristic looks for (see `CANDIDATES` in clustering/heuristic.ts), and the noise
 * notes name none.
 */
export const REJECTION_NOTES = {
  small: [
    (n: number) => `Too small — ${n} staff; can't absorb an integration.`,
    (n: number) => `Only ${n} people on the payroll; an integration would swamp them.`,
    (n: number) => `Headcount of ${n} is too thin to take on our process.`,
    (n: number) => `${n} employees in total, which is too small a platform for us.`,
    (n: number) => `Small shop of ${n} staff; key-person risk is too high.`,
    (n: number) => `With ${n} people the team could not run a deal and an integration at once.`,
    (n: number) => `Passing: ${n} staff is below the size we can integrate.`,
    (n: number) => `Headcount is ${n}; too small to stand alone inside the group.`,
  ],
  generalist: [
    "Generalist coverage with no sector depth; unfocused franchise.",
    "Covers a bit of everything; a generalist book that doesn't fit the thesis.",
    "Unfocused coverage, with no vertical where they lead.",
    "Generalist shop. We want a sector specialist, not another all-rounder.",
    "No sector depth to speak of; mandates are spread across too many industries.",
    "Pitches as a generalist and the mandate list confirms it.",
  ],
  dealSize: [
    (m: number) => `Deal size around $${m}m is below our floor; small deals.`,
    (m: number) => `Typical deal size is about $${m}m, below our floor.`,
    (m: number) => `Works on small deals, around $${m}m each; not worth the integration.`,
    (m: number) => `$${m}m average deal size; we need bigger tickets.`,
    (m: number) => `Deals average roughly $${m}m, well below our floor.`,
    (m: number) => `Their deal size (around $${m}m) sits under our minimum.`,
  ],
  dealVolume: [
    "Too few deals per MD over the last three years; weak deal volume.",
    "Deal volume is thin: under two closings per MD a year.",
    "Productivity per MD has been low for the last three years.",
    "Too few deals closed for a team this size.",
    "Weak deal volume; the MDs are not closing enough.",
  ],
  misc: [
    "Weak MD experience for our franchise.",
    "MD bench lacks the senior experience we need.",
    "Partners' backgrounds don't fit how we run mandates.",
    "Culture fit concerns after the partner meeting.",
    "Senior bankers came across as inexperienced in the meeting.",
  ],
} as const;

const nth = <T>(notes: readonly T[], i: number): T => notes[i % notes.length];

/** The note for the `i`-th firm rejected for each reason. */
export const smallFirmRationale = (employees: number | undefined, i = 0): string =>
  nth(REJECTION_NOTES.small, i)(employees ?? 0);
export const generalistRationale = (i = 0): string => nth(REJECTION_NOTES.generalist, i);
export const dealSizeRationale = (sizeMUsd: number, i = 0): string =>
  nth(REJECTION_NOTES.dealSize, i)(sizeMUsd);
export const dealVolumeRationale = (i = 0): string => nth(REJECTION_NOTES.dealVolume, i);
export const miscRationale = (i = 0): string => nth(REJECTION_NOTES.misc, i);

/** The deal size ($m) the analyst records before rejecting a firm for small deals. One draw. */
export const plantedDealSize = (r: Rng): number => 8 + Math.round(r() * 18);

/** The deals per MD the analyst records before rejecting a firm for weak volume. One draw. */
export const plantedDealVolume = (r: Rng): number => Math.round(r() * 15) / 10;

type FirmObj = ObjectOf<"Firm">;

/** The hard-screen rule each planted pattern implies, in the order the seed plants them. */
export const PLANTED_PREDICATES = [
  { key: "small", axis: "employees", operator: "<", threshold: "10" },
  { key: "generalist", axis: "coverage_model", operator: "==", threshold: "Generalist" },
  { key: "dealSize", axis: "deal_size_usd_m", operator: "<", threshold: "30" },
  { key: "dealVolume", axis: "deals_per_md_l3y", operator: "<", threshold: "2" },
] as const;

/** What planting a rejection needs from its caller: the world as it stands, and how to act on it. */
export interface RejectionEffects {
  /** Every firm in its current state. Read again before each step. */
  firms(): Promise<readonly FirmObj[]> | readonly FirmObj[];
  /** The analyst enters a value they found on the firm, before rejecting it for it. */
  record(
    firm: FirmObj,
    facts: { dealSizeMUsd: number } | { dealsPerMdL3y: number },
  ): Promise<void> | void;
  reject(firm: FirmObj, rationale: string): Promise<void> | void;
  /**
   * The draws behind the values the analyst enters, one per firm in the order below. The seed
   * passes its own stream, so these are the draws that stream makes at this point.
   */
  draw: Rng;
}

const generalist = (f: FirmObj): boolean => /generalist/i.test(f.coverageModel ?? "");

/**
 * The seed's rejections, chosen by the seed's rules: the first firms by name that are still being
 * looked at (Discovered or Screening), are not in `taken`, and fit each pattern. Small firms, then
 * generalists, then firms with small deals and with low deal volume (each given the value the
 * analyst found), then a few for a reason no screening rule can express. The one place that
 * decides which firms are rejected and why, so the seed and the evaluation plant the same patterns.
 * `taken` gains every rejected firm. Returns the firms per pattern, and the unexpressible ones.
 */
export async function planRejections(
  fx: RejectionEffects,
  taken: Set<string>,
): Promise<{ patterns: { key: string; firmIds: string[] }[]; noise: FirmObj[] }> {
  const pool = async (): Promise<FirmObj[]> =>
    sortedRows("Firm", await fx.firms(), ["firmName"]).filter(
      (f) =>
        !taken.has(f.$primaryKey) &&
        ["Discovered", "Screening"].includes(normalizeLifecycle(f.lifecycleState)) &&
        (f.firmType ?? "CF") === "CF",
    );
  const reject = async (firm: FirmObj, why: string): Promise<void> => {
    taken.add(firm.$primaryKey);
    await fx.reject(firm, why);
  };
  const patterns: { key: string; firmIds: string[] }[] = [];

  const small = (await pool())
    .filter((f) => (f.employees ?? 99) < 10)
    .slice(0, REJECTION_COUNTS.small);
  for (const [i, f] of small.entries()) {
    await reject(f, smallFirmRationale(f.employees, i));
  }
  patterns.push({ key: "small", firmIds: small.map((f) => f.$primaryKey) });

  const generalists = (await pool()).filter(generalist).slice(0, REJECTION_COUNTS.generalist);
  for (const [i, f] of generalists.entries()) {
    await reject(f, generalistRationale(i));
  }
  patterns.push({ key: "generalist", firmIds: generalists.map((f) => f.$primaryKey) });

  const smallDeals = (await pool())
    .filter((f) => f.dealSizeMUsd === undefined && (f.employees ?? 0) >= 10 && !generalist(f))
    .slice(0, REJECTION_COUNTS.dealSize);
  for (const [i, f] of smallDeals.entries()) {
    const size = plantedDealSize(fx.draw);
    await fx.record(f, { dealSizeMUsd: size });
    await reject(f, dealSizeRationale(size, i));
  }
  patterns.push({ key: "dealSize", firmIds: smallDeals.map((f) => f.$primaryKey) });

  const lowVolume = (await pool())
    .filter((f) => f.dealsPerMdL3y === undefined && (f.employees ?? 0) >= 10 && !generalist(f))
    .slice(0, REJECTION_COUNTS.dealVolume);
  for (const [i, f] of lowVolume.entries()) {
    await fx.record(f, { dealsPerMdL3y: plantedDealVolume(fx.draw) });
    await reject(f, dealVolumeRationale(i));
  }
  patterns.push({ key: "dealVolume", firmIds: lowVolume.map((f) => f.$primaryKey) });

  const noise = (await pool())
    .filter((f) => (f.employees ?? 0) >= 10 && !generalist(f))
    .slice(0, REJECTION_COUNTS.misc);
  for (const [i, f] of noise.entries()) {
    await reject(f, miscRationale(i));
  }
  return { patterns, noise };
}
