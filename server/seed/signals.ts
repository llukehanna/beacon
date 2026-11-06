/**
 * The synthetic market signals the demo ships with. `generateSignals` is a pure, seeded function
 * of the firms and the seed time: the same inputs always give the same signals. They are spread
 * from 21 days before the seed to 23 hours after it. Those dated at or before the seed are applied
 * while the demo is built (`seedSignals`), so their findings, score changes and drift events are
 * part of the seeded history. The rest stay unapplied in the snapshot; the hourly Cron Trigger
 * applies them as they come due, and every reset restores them, so they replay.
 *
 * Three groups, all invented:
 *  - movers: a short run of signals on one decided firm that, applied in order, moves its tier
 *    (a Passed firm up, so it resurfaces in Review; a qualified firm down). Each chain is checked
 *    against the real rubric before it is kept.
 *  - acquisitions: a rival buys a Passed firm ("we passed, the market did not").
 *  - background: single hires, departures and deal announcements on enriched firms still in
 *    screening, which move a score without any decision to drift from.
 *
 * Every signal on a decided firm is dated after that firm's decision, and every signal on an
 * enriched firm after its last enrichment, so the findings a signal writes are the newest on file.
 */
import type { SignalKind } from "../../shared/marketSignals.js";
import type { ObjectOf, Props } from "../../shared/schema.js";
import { scoreFirm } from "../../shared/scoring.js";
import { PASSED, isQualifiedOrLater, normalizeLifecycle } from "../../shared/vocab.js";
import type { Db } from "../db/client.js";
import { sortedRows } from "../db/ordering.js";
import { insertObjects, listAll } from "../db/repo.js";
import { type Rng, pick, rng } from "../enrichment/random.js";
import { applyDueSignals } from "../signals/run.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How far before the seed the first signal can fall, and how far after it the last can. */
export const LOOKBACK_MS = 21 * DAY;
export const LOOKAHEAD_MS = 23 * HOUR;
/** About this many signals in all: modest, so a reset stays cheap and the Review page stays readable. */
export const SIGNAL_TARGET = 48;
const MAX_CHAINS = { passed: 4, pipeline: 2 } as const;
const ACQUISITIONS = 4;
/** Signals the generator leaves unapplied for the cron: movers, an acquisition and background news. */
const FUTURE_MOVER_CHAINS = 2;
const FUTURE_ACQUISITIONS = 1;
const FUTURE_BACKGROUND = 3;

const TIER_RANK: Readonly<Record<string, number>> = { Rejected: 0, C: 1, B: 2, A: 3 };
const tierRank = (firm: Props<"Firm">): number => TIER_RANK[scoreFirm(firm).tier] ?? 0;

type FirmObj = ObjectOf<"Firm">;

/** One signal before it has a date. */
interface Step {
  kind: SignalKind;
  axis: string | null;
  field: keyof Props<"Firm"> | null;
  value: number | null;
}

interface Chain {
  firm: FirmObj;
  steps: Step[];
  /** The last step falls after the seed, for the hourly run to apply. */
  future: boolean;
  /** The signals on the firm come after this time. */
  floor: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v: number): number => Math.round(v * 10) / 10;

// ─── Moves ───────────────────────────────────────────────────────────────

const hire = (f: Props<"Firm">): Step => {
  const cur = num(f.feeGeneratingCount);
  return {
    kind: "senior_hire",
    axis: "fee_generating_count",
    field: "feeGeneratingCount",
    value: cur === null ? 2 : cur + 1,
  };
};

const departure = (f: Props<"Firm">): Step | null => {
  const cur = num(f.feeGeneratingCount);
  return cur === null || cur < 1
    ? null
    : {
        kind: "departure",
        axis: "fee_generating_count",
        field: "feeGeneratingCount",
        value: cur - 1,
      };
};

const largerDeal = (f: Props<"Firm">): Step => {
  const cur = num(f.dealSizeMUsd);
  return {
    kind: "deal_announcement",
    axis: "deal_size_usd_m",
    field: "dealSizeMUsd",
    value: cur === null ? 60 : Math.max(Math.round(cur * 1.5), Math.round(cur) + 15),
  };
};

const fasterPace = (f: Props<"Firm">): Step => {
  const cur = num(f.dealsPerMdL3y);
  return {
    kind: "deal_announcement",
    axis: "deals_per_md_l3y",
    field: "dealsPerMdL3y",
    value: cur === null ? 2 : round1(cur + 1),
  };
};

const applyStep = (f: FirmObj, s: Step): FirmObj =>
  s.field === null || s.value === null ? f : { ...f, [s.field]: s.value };

/**
 * Raise a firm's score step by step, each time taking the move that gains most (a hire when none
 * gains), until its tier is higher than it started or the steps run out. Null when it never gets
 * there, as for a firm a hard screen rejects.
 */
function raisingChain(firm: FirmObj, maxSteps = 4): Step[] | null {
  const start = tierRank(firm);
  if (scoreFirm(firm).hardRejected) {
    return null;
  }
  const steps: Step[] = [];
  let cur = firm;
  while (steps.length < maxSteps) {
    const options = [hire(cur), largerDeal(cur), fasterPace(cur)];
    const gain = (s: Step): number =>
      scoreFirm(applyStep(cur, s)).weightedTotal - scoreFirm(cur).weightedTotal;
    const best = options.reduce((a, b) => (gain(b) > gain(a) ? b : a));
    steps.push(best);
    cur = applyStep(cur, best);
    if (tierRank(cur) > start) {
      return steps;
    }
  }
  return null;
}

/** Lower a firm's score by senior departures until its tier is lower than it started. */
function loweringChain(firm: FirmObj, maxSteps = 4): Step[] | null {
  const start = tierRank(firm);
  const steps: Step[] = [];
  let cur = firm;
  while (steps.length < maxSteps) {
    const step = departure(cur);
    if (step === null) {
      return null;
    }
    steps.push(step);
    cur = applyStep(cur, step);
    if (tierRank(cur) < start) {
      return steps;
    }
  }
  return null;
}

// ─── Words ───────────────────────────────────────────────────────────────

const HEADLINES = {
  senior_hire: [
    "{name} hires a senior banker from a rival boutique",
    "{name} adds a new partner to its advisory team",
    "{name} recruits a managing director to lead origination",
  ],
  departure: [
    "{name} loses a senior partner to a competitor",
    "{name}: a managing director leaves to start a new firm",
    "The head of origination at {name} steps down",
  ],
  deal_size: [
    "{name} announces a {size} sell-side mandate",
    "{name} advises on a {size} cross-border transaction",
    "{name} signs a {size} engagement with a new client",
  ],
  deal_pace: [
    "{name} closes its third deal of the quarter",
    "{name} reports a busier quarter, with more deals per managing director",
    "{name} wins two new mandates in a month",
  ],
  acquisition: [
    "{name} agrees to be acquired by a larger rival",
    "{name} is bought by a regional advisory group",
    "{name} is absorbed into a competitor's corporate finance arm",
  ],
} as const;

function headlineFor(r: Rng, step: Step, name: string): string {
  const set =
    step.kind === "deal_announcement"
      ? step.axis === "deals_per_md_l3y"
        ? HEADLINES.deal_pace
        : HEADLINES.deal_size
      : HEADLINES[step.kind];
  const size = step.value === null ? "mid-market" : `$${Math.round(step.value)}m`;
  return pick(r, set).replace("{name}", name).replace("{size}", size);
}

// ─── Dates ───────────────────────────────────────────────────────────────

/**
 * Dates for a chain of `count` signals, ascending, at least a minute apart, as epoch milliseconds.
 * Past ones fall between `lo` and the seed; a future chain's last signal falls in the hours after
 * the seed. Every draw is made as an offset from `anchor`, in whole minutes, so the same seed made
 * at a later time gives the same offsets and a snapshot restored later matches a rebuild exactly.
 */
function datesFor(r: Rng, count: number, lo: number, anchor: number, future: boolean): number[] {
  const low = lo - anchor; // offsets, in milliseconds: exact integers, so no rounding differs by anchor
  const hasPast = low < -2 * MINUTE;
  // A firm touched in the last minutes has no room before the seed: all its news is still to come.
  future = future || !hasPast;
  const minutes = (ms: number): number => Math.floor(ms / MINUTE) * MINUTE;
  const draw = (from: number, to: number, n: number): number[] =>
    Array.from({ length: n }, () => minutes(from + r() * (to - from))).sort((a, b) => a - b);
  const out: number[] = [];
  if (future) {
    const last = minutes(HOUR + r() * (LOOKAHEAD_MS - HOUR));
    out.push(...(count > 1 ? draw(hasPast ? low : HOUR, hasPast ? 0 : last, count - 1) : []), last);
  } else {
    out.push(...draw(low, 0, count));
  }
  // Strictly ascending, so a chain's order is its dates' order.
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) {
      out[i] = out[i - 1] + MINUTE;
    }
  }
  return out.map((offset) => anchor + offset);
}

// ─── Generation ──────────────────────────────────────────────────────────

export interface SignalInputs {
  firms: readonly FirmObj[];
  /** When each firm was last decided on, in epoch milliseconds. */
  decidedAt: ReadonlyMap<string, number>;
  /** Firms with an open drift event: a signal on one could not be told apart from it, so none is made. */
  openDriftFirms: ReadonlySet<string>;
  anchor: Date;
}

const ms = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** The firm's newest enrichment, review or decision. */
const floorOf = (f: FirmObj, decidedAt: ReadonlyMap<string, number>): number =>
  Math.max(ms(f.enrichedAt), ms(f.lastReviewed), decidedAt.get(f.$primaryKey) ?? 0) + 30 * MINUTE;

/** The signals for a seed made at `anchor`: deterministic, about SIGNAL_TARGET of them. */
export function generateSignals(input: SignalInputs): Props<"MarketSignal">[] {
  const r = rng("beacon-signals-v1");
  const anchor = input.anchor.getTime();
  const firms = sortedRows("Firm", input.firms);
  const lowest = anchor - LOOKBACK_MS;
  const chains: Chain[] = [];
  const used = new Set<string>();
  const take = (firm: FirmObj, steps: Step[], future: boolean): void => {
    used.add(firm.$primaryKey);
    chains.push({
      firm,
      steps,
      future,
      floor: Math.max(lowest, floorOf(firm, input.decidedAt)),
    });
  };
  const free = (f: FirmObj): boolean =>
    !used.has(f.$primaryKey) && !input.openDriftFirms.has(f.$primaryKey);
  const stateOf = (f: FirmObj) => normalizeLifecycle(f.lifecycleState);
  /** A fair shuffle that stays the same for the same seed. */
  const shuffled = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  // Movers. Passed firms that can climb a tier, and pipeline firms that can fall one.
  let movers = 0;
  const futureMovers = (): boolean => movers++ < FUTURE_MOVER_CHAINS;
  let passedChains = 0;
  for (const f of shuffled(firms.filter((x) => stateOf(x) === PASSED && free(x)))) {
    if (passedChains >= MAX_CHAINS.passed) {
      break;
    }
    const steps = raisingChain(f);
    if (steps !== null) {
      take(f, steps, futureMovers());
      passedChains++;
    }
  }
  let pipelineChains = 0;
  for (const f of shuffled(firms.filter((x) => isQualifiedOrLater(stateOf(x)) && free(x)))) {
    if (pipelineChains >= MAX_CHAINS.pipeline) {
      break;
    }
    const steps = loweringChain(f);
    if (steps !== null) {
      take(f, steps, futureMovers());
      pipelineChains++;
    }
  }

  // Acquisitions of Passed firms nobody has seen acquired yet.
  const acquirable = shuffled(
    firms.filter((x) => stateOf(x) === PASSED && free(x) && (x.outcome ?? "") === ""),
  ).slice(0, ACQUISITIONS);
  acquirable.forEach((f, i) =>
    take(
      f,
      [{ kind: "acquisition", axis: null, field: null, value: null }],
      i < FUTURE_ACQUISITIONS,
    ),
  );

  // Background news on firms that have been enriched and are still being screened.
  const pool = shuffled(
    firms.filter(
      (x) =>
        stateOf(x) === "Screening" &&
        free(x) &&
        (num(x.feeGeneratingCount) !== null ||
          num(x.dealSizeMUsd) !== null ||
          num(x.dealsPerMdL3y) !== null),
    ),
  );
  const planned = chains.reduce((n, c) => n + c.steps.length, 0);
  let background = 0;
  for (const f of pool) {
    if (planned + background >= SIGNAL_TARGET) {
      break;
    }
    const options: Step[] = [
      ...(num(f.feeGeneratingCount) !== null ? [hire(f), departure(f)] : []),
      ...(num(f.dealSizeMUsd) !== null ? [largerDeal(f)] : []),
      ...(num(f.dealsPerMdL3y) !== null ? [fasterPace(f)] : []),
    ].filter((s): s is Step => s !== null);
    if (options.length > 0) {
      take(f, [pick(r, options)], background < FUTURE_BACKGROUND);
      background++;
    }
  }

  // Dates and words.
  const signals: Props<"MarketSignal">[] = [];
  for (const chain of chains) {
    const dates = datesFor(r, chain.steps.length, chain.floor, anchor, chain.future);
    chain.steps.forEach((step, i) => {
      signals.push({
        firmId: chain.firm.$primaryKey,
        kind: step.kind,
        effectiveDate: new Date(dates[i]).toISOString(),
        headline: headlineFor(r, step, chain.firm.firmName ?? chain.firm.$primaryKey),
        ...(step.axis !== null && step.value !== null
          ? { axis: step.axis, newValue: String(step.value) }
          : {}),
      });
    });
  }
  signals.sort(
    (a, b) =>
      Date.parse(a.effectiveDate!) - Date.parse(b.effectiveDate!) ||
      a.firmId!.localeCompare(b.firmId!),
  );
  return signals.map((s, i) => ({ ...s, signalId: `signal-${String(i + 1).padStart(4, "0")}` }));
}

/**
 * Generate the signals for a demo just built and shifted to `anchor`, store them, and apply those
 * already due, each as of its own date. Runs in the caller's transaction when `db` joins one.
 */
export async function seedSignals(
  db: Db,
  anchor: Date,
  newId: (prefix: string) => string,
): Promise<{ total: number; applied: number }> {
  const firms = await listAll(db, "Firm");
  const decided = await db.query<{ firmId: string; at: Date | string }>(
    `SELECT "firmId", max("decidedAt") AS at FROM review_decision GROUP BY "firmId"`,
  );
  const open = await db.query<{ firmId: string }>(
    `SELECT DISTINCT "firmId" FROM drift_event WHERE lower(coalesce("driftStatus", '')) <> 'resolved'`,
  );
  const signals = generateSignals({
    firms,
    decidedAt: new Map(decided.map((d) => [d.firmId, new Date(d.at).getTime()])),
    openDriftFirms: new Set(open.map((o) => o.firmId)),
    anchor,
  });
  await insertObjects(db, "MarketSignal", signals);
  const { applied } = await applyDueSignals(db, anchor, {
    limit: Number.POSITIVE_INFINITY,
    backfill: true,
    newId,
  });
  return { total: signals.length, applied: applied.length };
}
