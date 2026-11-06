import { beforeAll, describe, expect, it } from "vitest";
import { SIGNAL_KINDS } from "../../shared/marketSignals.js";
import type { ObjectOf } from "../../shared/schema.js";
import type { Db } from "../db/client.js";
import { listAll } from "../db/repo.js";
import { MAX_SIGNALS_PER_RUN, applyDueSignals } from "../signals/run.js";
import { createTestDb } from "../testing.js";
import { resetDemo } from "./reset.js";
import {
  LOOKAHEAD_MS,
  LOOKBACK_MS,
  SIGNAL_TARGET,
  type SignalInputs,
  generateSignals,
} from "./signals.js";
import { resetFromSnapshot, saveSnapshot } from "./snapshot.js";

const HOUR = 3_600_000;
const ANCHOR = new Date("2026-11-06T12:00:00.000Z");

/** A small population: screening firms with figures, weak passed firms, and qualified ones. */
function population(): { firms: ObjectOf<"Firm">[]; decidedAt: Map<string, number> } {
  const firms: ObjectOf<"Firm">[] = [];
  const decidedAt = new Map<string, number>();
  const add = (id: string, state: string, over: Record<string, unknown>): void => {
    firms.push({
      $apiName: "Firm",
      $primaryKey: id,
      firmId: id,
      firmName: `Firm ${id}`,
      firmType: "CF",
      coverageModel: "Single-sector focus",
      geoScore: 2,
      lifecycleState: state,
      enrichedAt: new Date(ANCHOR.getTime() - 20 * HOUR).toISOString(),
      ...over,
    } as ObjectOf<"Firm">);
  };
  for (let i = 0; i < 60; i++) {
    add(`screen-${String(i).padStart(2, "0")}`, "Screening", {
      feeGeneratingCount: 2 + (i % 5),
      dealSizeMUsd: 30 + i,
      dealsPerMdL3y: 1 + (i % 4),
    });
  }
  for (let i = 0; i < 12; i++) {
    const id = `passed-${String(i).padStart(2, "0")}`;
    add(id, "Passed", { employees: 6, dealsPerMdL3y: 0.5, firmAge: 3 });
    decidedAt.set(id, ANCHOR.getTime() - 30 * HOUR);
  }
  for (let i = 0; i < 4; i++) {
    const id = `qualified-${i}`;
    add(id, "Qualified", {
      feeGeneratingCount: 6,
      dealSizeMUsd: 200,
      dealsPerMdL3y: 2,
      firmAge: 8,
      employees: 50,
      servicesFit: "Full advisory suite",
      mdPedigree: "Bulge-bracket or elite-boutique alumni",
      geoScore: 1,
    });
    decidedAt.set(id, ANCHOR.getTime() - 40 * HOUR);
  }
  return { firms, decidedAt };
}

const inputs = (over: Partial<SignalInputs> = {}): SignalInputs => ({
  ...population(),
  openDriftFirms: new Set(),
  anchor: ANCHOR,
  ...over,
});

describe("generateSignals", () => {
  it("is deterministic", () => {
    expect(generateSignals(inputs())).toEqual(generateSignals(inputs()));
  });

  it("makes a modest number of signals, of every kind, with unique ids", () => {
    const signals = generateSignals(inputs());
    expect(signals.length).toBeGreaterThanOrEqual(40);
    expect(signals.length).toBeLessThanOrEqual(60);
    expect(new Set(signals.map((s) => s.kind))).toEqual(new Set(SIGNAL_KINDS));
    expect(new Set(signals.map((s) => s.signalId)).size).toBe(signals.length);
    for (const s of signals) {
      const id = s.signalId ?? "";
      expect(s.headline, id).toMatch(/\S/);
      // An acquisition moves no score axis; every other kind names one and the value it moves to.
      if (s.kind === "acquisition") {
        expect([s.axis, s.newValue], id).toEqual([undefined, undefined]);
      } else {
        expect(s.axis, id).toMatch(/^[a-z0-9_]+$/);
        expect(Number.isFinite(Number(s.newValue)), id).toBe(true);
      }
      expect(s.headline, id).not.toMatch(/\{|undefined|'s head/);
    }
  });

  it("spreads dates from three weeks before the seed to under a day after it", () => {
    const at = generateSignals(inputs()).map((s) => Date.parse(s.effectiveDate!));
    const anchor = ANCHOR.getTime();
    expect(Math.min(...at)).toBeGreaterThanOrEqual(anchor - LOOKBACK_MS);
    expect(Math.max(...at)).toBeLessThanOrEqual(anchor + LOOKAHEAD_MS);
    const future = at.filter((t) => t > anchor);
    expect(future.length, "a handful are still to come").toBeGreaterThanOrEqual(3);
    expect(future.length).toBeLessThanOrEqual(MAX_SIGNALS_PER_RUN);
    expect(Math.min(...future)).toBeGreaterThanOrEqual(anchor + HOUR - 60_000);
  });

  it("dates a signal on a decided firm after the firm was decided", () => {
    const { firms, decidedAt } = population();
    const signals = generateSignals({
      firms,
      decidedAt,
      openDriftFirms: new Set(),
      anchor: ANCHOR,
    });
    const decided = signals.filter((s) => decidedAt.has(s.firmId!));
    expect(decided.length).toBeGreaterThan(0);
    for (const s of decided) {
      expect(Date.parse(s.effectiveDate!), s.signalId ?? "").toBeGreaterThan(
        decidedAt.get(s.firmId!)!,
      );
    }
  });

  it("keeps a chain of signals on one firm in order, so each absolute value follows the last", () => {
    const signals = generateSignals(inputs());
    const byFirm = new Map<string, typeof signals>();
    for (const s of signals) {
      byFirm.set(s.firmId!, [...(byFirm.get(s.firmId!) ?? []), s]);
    }
    const chains = [...byFirm.values()].filter((c) => c.length > 1);
    expect(chains.length, "some firms have more than one signal").toBeGreaterThan(0);
    for (const chain of chains) {
      const dates = chain.map((s) => Date.parse(s.effectiveDate!));
      expect(dates).toEqual([...dates].sort((a, b) => a - b));
      expect(new Set(dates).size).toBe(dates.length);
    }
  });

  it("leaves out firms that already have an open drift event", () => {
    const leave = new Set(["screen-00", "screen-01", "passed-00", "qualified-0"]);
    const touched = new Set(
      generateSignals(inputs({ openDriftFirms: leave })).map((s) => s.firmId as string),
    );
    for (const id of leave) {
      expect(touched.has(id), id).toBe(false);
    }
  });

  it("makes nothing for a population with no known figures and no decided firms", () => {
    const { firms } = population();
    expect(
      generateSignals({
        firms: firms
          .filter((f) => f.lifecycleState === "Screening")
          .map((f) => ({
            ...f,
            feeGeneratingCount: undefined,
            dealSizeMUsd: undefined,
            dealsPerMdL3y: undefined,
          })),
        decidedAt: new Map(),
        openDriftFirms: new Set(),
        anchor: ANCHOR,
      }),
    ).toEqual([]);
  });
});

describe("the seeded demo's signals", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
    await resetDemo(db, ANCHOR);
  }, 300_000);

  it("holds about fifty signals: those already due are applied, a handful are still to come", async () => {
    const signals = await listAll(db, "MarketSignal");
    expect(signals).toHaveLength(SIGNAL_TARGET);
    const applied = signals.filter((s) => s.appliedAt !== undefined);
    const waiting = signals.filter((s) => s.appliedAt === undefined);
    for (const s of applied) {
      expect(s.appliedAt, s.signalId).toBe(s.effectiveDate);
      expect(Date.parse(s.effectiveDate!)).toBeLessThanOrEqual(ANCHOR.getTime());
    }
    expect(waiting.length).toBeGreaterThanOrEqual(3);
    expect(waiting.length).toBeLessThanOrEqual(MAX_SIGNALS_PER_RUN);
    for (const s of waiting) {
      const ahead = Date.parse(s.effectiveDate!) - ANCHOR.getTime();
      expect(ahead, s.signalId).toBeGreaterThan(0);
      expect(ahead, s.signalId).toBeLessThanOrEqual(LOOKAHEAD_MS);
    }
  });

  it("puts the applied signals' findings, scores and drift into the seeded history", async () => {
    const findings = await listAll(db, "ResearchFinding", {
      where: { provider: { $eq: "market_signal" } },
    });
    expect(findings.length).toBeGreaterThan(10);
    for (const f of findings) {
      expect(f.sourceQuote, f.findingId).toBeUndefined();
      expect(f.sourceDocumentId, f.findingId).toBeUndefined();
      expect(Date.parse(f.retrievedAt!)).toBeLessThanOrEqual(ANCHOR.getTime());
    }
    const drifts = await listAll(db, "DriftEvent");
    const fromSignals = drifts.filter((d) => d.changedAxes?.includes("Synthetic market signal"));
    expect(fromSignals.length, "tier drift opened by a signal").toBeGreaterThanOrEqual(2);
    const acquired = await listAll(db, "Firm", {
      where: { outcome: { $eq: "acquired_by_competitor" } },
    });
    expect(acquired.length).toBeGreaterThanOrEqual(3);
    for (const f of acquired) {
      expect(
        drifts.some((d) => d.firmId === f.$primaryKey && d.driftReason === "outcome_diverged"),
        f.$primaryKey,
      ).toBe(true);
    }
  });

  it("leaves the firms whose agent runs wait on the analyst untouched", async () => {
    const agentRun = await db.query<{ firmId: string }>(
      `SELECT "firmId" FROM firm WHERE "enrichedBy" = 'agent'`,
    );
    const touched = new Set((await listAll(db, "MarketSignal")).map((s) => s.firmId));
    expect(agentRun.length).toBeGreaterThan(0);
    expect(agentRun.filter((o) => touched.has(o.firmId))).toEqual([]);
  });

  it("applies the rest within a day, a bounded batch at a time, touching only the firms they name", async () => {
    const waiting = (await listAll(db, "MarketSignal")).filter((s) => s.appliedAt === undefined);
    const named = new Set(waiting.map((s) => s.firmId));
    const others = async (): Promise<string> => {
      const [{ h }] = await db.query<{ h: string }>(
        `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h
           FROM firm t WHERE "firmId" <> ALL($1::text[])`,
        [[...named]],
      );
      return h;
    };
    const before = await others();
    const end = new Date(ANCHOR.getTime() + 24 * HOUR);
    let appliedNow = 0;
    for (let hour = 1; hour <= 24; hour++) {
      const run = await applyDueSignals(db, new Date(ANCHOR.getTime() + hour * HOUR));
      expect(run.applied.length).toBeLessThanOrEqual(MAX_SIGNALS_PER_RUN);
      appliedNow += run.applied.length;
    }
    expect(appliedNow).toBe(waiting.length);
    expect(await others()).toBe(before);
    expect((await applyDueSignals(db, end)).applied).toEqual([]);
  }, 300_000);

  it("replays the signals after a reset, because the snapshot keeps them unapplied", async () => {
    const fresh = await createTestDb();
    await resetDemo(fresh, ANCHOR);
    await saveSnapshot(fresh, ANCHOR);
    const waiting = (await listAll(fresh, "MarketSignal")).filter((s) => s.appliedAt === undefined);
    expect(
      (await applyDueSignals(fresh, new Date(ANCHOR.getTime() + 24 * HOUR))).applied,
    ).toHaveLength(waiting.length);

    const later = new Date(ANCHOR.getTime() + 48 * HOUR);
    await resetFromSnapshot(fresh, later);
    const after = (await listAll(fresh, "MarketSignal")).filter((s) => s.appliedAt === undefined);
    expect(after.map((s) => s.signalId).sort()).toEqual(waiting.map((s) => s.signalId).sort());
    for (const s of after) {
      const was = waiting.find((w) => w.signalId === s.signalId)!;
      expect(Date.parse(s.effectiveDate!) - Date.parse(was.effectiveDate!)).toBe(48 * HOUR);
    }
    // And they come due again after the reset, not before.
    expect((await applyDueSignals(fresh, later)).applied).toEqual([]);
    expect(
      (await applyDueSignals(fresh, new Date(later.getTime() + 24 * HOUR))).applied,
    ).toHaveLength(waiting.length);
  }, 300_000);
});
