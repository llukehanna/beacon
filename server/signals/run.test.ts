import { describe, expect, it } from "vitest";
import type { Props } from "../../shared/schema.js";
import type { Db } from "../db/client.js";
import { getObject, insertObject, listAll } from "../db/repo.js";
import { STRONG_CF, T0, createTestDb, run, seedFirm } from "../testing.js";
import { MAX_SIGNALS_PER_RUN, applyDueSignals } from "./run.js";

const NOW = new Date(T0.getTime() + 3_600_000);
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

async function addSignal(db: Db, s: Props<"MarketSignal"> & { signalId: string }): Promise<void> {
  await insertObject(db, "MarketSignal", {
    kind: "departure",
    headline: "A partner leaves",
    axis: "fee_generating_count",
    newValue: "3",
    ...s,
  });
}

/** A qualified firm on the tier A floor (14 points): losing a fee-earner band takes it to B. */
const AT_THE_FLOOR: Props<"Firm"> = {
  ...STRONG_CF,
  dealsPerMdL3y: 2,
  firmAge: 8,
  employees: 50,
  geoScore: 1,
  feeGeneratingCount: 4,
};

/** A hash per table, to tell what a run changed. */
async function fingerprint(db: Db): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of [
    "firm",
    "research_finding",
    "qualification_score",
    "drift_event",
    "market_signal",
  ]) {
    const [row] = await db.query<{ h: string }>(
      `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM ${table} t`,
    );
    out[table] = row.h;
  }
  return out;
}

describe("applyDueSignals", () => {
  it("applying due signals is idempotent: a second run applies nothing and sets appliedAt once", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, AT_THE_FLOOR);
    await addSignal(db, { signalId: "s1", firmId: firm.$primaryKey, effectiveDate: hoursAgo(5) });
    await addSignal(db, {
      signalId: "s2",
      firmId: firm.$primaryKey,
      kind: "deal_announcement",
      axis: "deal_size_usd_m",
      newValue: "300",
      effectiveDate: hoursAgo(3),
    });

    const first = await applyDueSignals(db, NOW);
    expect(first.applied).toEqual(["s1", "s2"]);
    const signals = await listAll(db, "MarketSignal");
    expect(signals.map((s) => s.appliedAt)).toEqual([NOW.toISOString(), NOW.toISOString()]);

    const before = await fingerprint(db);
    const second = await applyDueSignals(db, new Date(NOW.getTime() + 60_000));
    expect(second).toEqual({ applied: [], drifts: [] });
    expect(await fingerprint(db)).toEqual(before);
  });

  it("a departure lowers the axis, writes its finding and a new score, and can move the tier", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, AT_THE_FLOOR);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    await addSignal(db, { signalId: "s1", firmId: firm.$primaryKey, effectiveDate: hoursAgo(2) });

    const { drifts } = await applyDueSignals(db, NOW);

    expect((await getObject(db, "Firm", firm.$primaryKey))?.feeGeneratingCount).toBe(3);
    const findings = await listAll(db, "ResearchFinding", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      axis: "fee_generating_count",
      value: "3",
      provider: "market_signal",
      findingStatus: "signal",
      verifiedByHuman: false,
      normalizedScore: 1,
      retrievedAt: NOW.toISOString(),
    });
    expect(findings[0].confidence).toBeUndefined();
    expect(findings[0].confidenceTier).toBeUndefined();
    expect(findings[0].sourceQuote).toBeUndefined();
    expect(findings[0].sourceDocumentId).toBeUndefined();
    const scores = await listAll(db, "QualificationScore", {
      where: { computedBy: { $eq: "marketSignal" } },
    });
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ tier: "B", weightedTotal: 13 });

    expect(drifts).toHaveLength(1);
    expect(await getObject(db, "DriftEvent", drifts[0])).toMatchObject({
      firmId: firm.$primaryKey,
      driftReason: "tier_moved",
      driftStatus: "open",
      priorTier: "A",
      newTier: "B",
    });
    const axes = JSON.parse((await getObject(db, "DriftEvent", drifts[0]))!.changedAxes!) as {
      axis: string;
      source: string;
    }[];
    expect(axes).toEqual([
      expect.objectContaining({ axis: "Fee-Generating", source: "Synthetic market signal" }),
    ]);
  });

  it("opens no drift when the departure leaves the tier where it was", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF); // 18 points: 17 is still tier A
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    await addSignal(db, { signalId: "s1", firmId: firm.$primaryKey, effectiveDate: hoursAgo(2) });
    const { drifts } = await applyDueSignals(db, NOW);
    expect(drifts).toEqual([]);
    expect(await listAll(db, "DriftEvent")).toHaveLength(0);
    expect((await getObject(db, "Firm", firm.$primaryKey))?.feeGeneratingCount).toBe(3);
  });

  it("an acquisition signal resurfaces a passed firm in Review", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Not a fit" });
    expect(await listAll(db, "DriftEvent")).toHaveLength(0);
    await addSignal(db, {
      signalId: "s1",
      firmId: firm.$primaryKey,
      kind: "acquisition",
      axis: undefined,
      newValue: undefined,
      headline: "Test Advisors agrees to be acquired by a larger rival",
      effectiveDate: hoursAgo(1),
    });

    const { drifts } = await applyDueSignals(db, NOW);

    expect(drifts).toHaveLength(1);
    expect(await getObject(db, "DriftEvent", drifts[0])).toMatchObject({
      firmId: firm.$primaryKey,
      driftReason: "outcome_diverged",
      driftStatus: "open",
    });
    expect(await getObject(db, "Firm", firm.$primaryKey)).toMatchObject({
      outcome: "acquired_by_competitor",
      outcomeObservedAt: hoursAgo(1),
      lifecycleState: "Passed",
    });
    // An acquisition moves no rubric axis, so it writes no finding and no new score.
    expect(await listAll(db, "ResearchFinding")).toHaveLength(0);
    expect(
      await listAll(db, "QualificationScore", { where: { computedBy: { $eq: "marketSignal" } } }),
    ).toHaveLength(0);
  });

  it("a senior hire can lift a passed firm a tier, which sends it back to Review", async () => {
    const db = await createTestDb();
    // 5 points, tier Rejected. Four fee-earners score two points instead of none: 7 points, tier C.
    const firm = await seedFirm(db, { employees: 6, feeGeneratingCount: 1, dealsPerMdL3y: 2 });
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Too small" });
    await addSignal(db, {
      signalId: "s1",
      firmId: firm.$primaryKey,
      kind: "senior_hire",
      newValue: "4",
      effectiveDate: hoursAgo(2),
    });
    const { drifts } = await applyDueSignals(db, NOW);
    expect(drifts).toHaveLength(1);
    expect(await getObject(db, "DriftEvent", drifts[0])).toMatchObject({
      driftReason: "pass_reason_invalidated",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest types asymmetric matchers as any
      newTier: expect.stringMatching(/^[ABC]$/),
    });
  });

  it("an acquisition's drift and outcome are labelled synthetic, and an analyst's outcome replaces the label", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "Not a fit" });
    await addSignal(db, {
      signalId: "s1",
      firmId: firm.$primaryKey,
      kind: "acquisition",
      axis: undefined,
      newValue: undefined,
      effectiveDate: hoursAgo(1),
    });
    const { drifts } = await applyDueSignals(db, NOW);
    const drift = (await getObject(db, "DriftEvent", drifts[0]))!;
    const axes = JSON.parse(drift.changedAxes!) as Record<string, unknown>[];
    expect(axes).toEqual([expect.objectContaining({ source: "Synthetic market signal" })]);
    expect(axes[0], "when it happened is detectedAt, not a key in the axes").not.toHaveProperty(
      "dated",
    );
    expect(drift.detectedAt).toBeDefined();
    expect((await getObject(db, "Firm", firm.$primaryKey))?.outcomeSource).toBe("market_signal");
    await run(db, "setFirmOutcome", {
      firm: firm.$primaryKey,
      outcome: "went_cold",
      outcomeObservedAt: NOW.toISOString(),
    });
    expect((await getObject(db, "Firm", firm.$primaryKey))?.outcomeSource).toBeUndefined();
  });

  it("stamps a signal it could not use as applied, with no change, no finding and no score", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { ...AT_THE_FLOOR, feeGeneratingCount: undefined });
    const noFee = firm.$primaryKey;
    const withFee = (await seedFirm(db, AT_THE_FLOOR)).$primaryKey;
    await addSignal(db, { signalId: "empty", firmId: noFee, effectiveDate: hoursAgo(4) });
    await addSignal(db, {
      signalId: "clamped",
      firmId: withFee,
      newValue: "9", // a departure never raises the count
      effectiveDate: hoursAgo(3),
    });
    await addSignal(db, {
      signalId: "moved",
      firmId: withFee,
      newValue: "3",
      effectiveDate: hoursAgo(2),
    });
    const before = await listAll(db, "QualificationScore");
    expect((await applyDueSignals(db, NOW)).applied).toEqual(["empty", "clamped", "moved"]);

    const byId = new Map((await listAll(db, "MarketSignal")).map((s) => [s.signalId, s]));
    expect(byId.get("empty")).toMatchObject({ appliedAt: NOW.toISOString(), effect: "unchanged" });
    expect(byId.get("clamped")).toMatchObject({
      appliedAt: NOW.toISOString(),
      effect: "unchanged",
    });
    expect(byId.get("moved")?.effect).toBe("moved");
    expect((await getObject(db, "Firm", noFee))?.feeGeneratingCount).toBeUndefined();
    const findings = await listAll(db, "ResearchFinding");
    expect(findings).toHaveLength(1);
    expect(findings[0].firmId).toBe(withFee);
    expect((await listAll(db, "QualificationScore")).length - before.length).toBe(1);
    // Applied once: a second run does not try them again.
    expect((await applyDueSignals(db, NOW)).applied).toEqual([]);
  });

  it("an analyst's check made after the news outranks it: the signal is listed, the tier does not move", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, AT_THE_FLOOR);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    await insertObject(db, "ResearchFinding", {
      findingId: "mine",
      firmId: firm.$primaryKey,
      axis: "fee_generating_count",
      value: "4",
      provider: "analyst",
      findingStatus: "verified",
      verifiedByHuman: true,
      verifiedAt: hoursAgo(1), // after the signal's date
      retrievedAt: hoursAgo(1),
    });
    await addSignal(db, { signalId: "s1", firmId: firm.$primaryKey, effectiveDate: hoursAgo(3) });
    const { applied, drifts } = await applyDueSignals(db, NOW);
    expect(applied).toEqual(["s1"]);
    expect(drifts).toEqual([]);
    expect((await getObject(db, "Firm", firm.$primaryKey))?.feeGeneratingCount).toBe(4);
    expect(await listAll(db, "DriftEvent")).toHaveLength(0);
    expect((await getObject(db, "MarketSignal", "s1"))?.effect).toBe("unchanged");
    expect(
      (await listAll(db, "ResearchFinding")).filter((f) => f.provider === "market_signal"),
    ).toHaveLength(0);
  });

  it("leaves signals that are not yet due alone", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, AT_THE_FLOOR);
    await addSignal(db, {
      signalId: "later",
      firmId: firm.$primaryKey,
      effectiveDate: hoursAhead(2),
    });
    const before = await fingerprint(db);
    expect(await applyDueSignals(db, NOW)).toEqual({ applied: [], drifts: [] });
    expect(await fingerprint(db)).toEqual(before);
    expect((await applyDueSignals(db, new Date(NOW.getTime() + 3 * 3_600_000))).applied).toEqual([
      "later",
    ]);
  });

  it("applies a bounded batch per run and touches only the firms it names", async () => {
    const db = await createTestDb();
    const total = MAX_SIGNALS_PER_RUN * 2 + 5;
    const firms = [];
    for (let i = 0; i < total; i++) {
      firms.push(
        await seedFirm(db, { ...AT_THE_FLOOR, firmId: `bulk-${String(i).padStart(2, "0")}` }),
      );
      await addSignal(db, {
        signalId: `s${String(i).padStart(2, "0")}`,
        firmId: `bulk-${String(i).padStart(2, "0")}`,
        effectiveDate: hoursAgo(total - i),
      });
    }
    const bystander = await seedFirm(db, { ...AT_THE_FLOOR, firmId: "bystander" });

    const first = await applyDueSignals(db, NOW);
    expect(first.applied).toHaveLength(MAX_SIGNALS_PER_RUN);
    // Oldest first: the first ten, and nothing else changed.
    expect(first.applied).toEqual(
      Array.from({ length: MAX_SIGNALS_PER_RUN }, (_, i) => `s${String(i).padStart(2, "0")}`),
    );
    const changed = (await listAll(db, "Firm")).filter((f) => f.feeGeneratingCount === 3);
    expect(changed.map((f) => f.$primaryKey).sort()).toEqual(
      first.applied.map((id) => `bulk-${id.slice(1)}`),
    );
    expect((await getObject(db, "Firm", bystander.$primaryKey))?.feeGeneratingCount).toBe(4);
    expect(await listAll(db, "ResearchFinding")).toHaveLength(MAX_SIGNALS_PER_RUN);

    expect((await applyDueSignals(db, NOW)).applied).toHaveLength(MAX_SIGNALS_PER_RUN);
    expect((await applyDueSignals(db, NOW)).applied).toHaveLength(5);
    expect((await applyDueSignals(db, NOW)).applied).toHaveLength(0);
    expect(firms).toHaveLength(total);
  });

  it("can apply a whole backlog as history, each signal stamped with its own date", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, AT_THE_FLOOR);
    await addSignal(db, { signalId: "s1", firmId: firm.$primaryKey, effectiveDate: hoursAgo(30) });
    await addSignal(db, {
      signalId: "s2",
      firmId: firm.$primaryKey,
      kind: "senior_hire",
      newValue: "5",
      effectiveDate: hoursAgo(20),
    });
    const { applied } = await applyDueSignals(db, NOW, {
      limit: Number.POSITIVE_INFINITY,
      backfill: true,
    });
    expect(applied).toEqual(["s1", "s2"]);
    const signals = await listAll(db, "MarketSignal", { orderBy: { effectiveDate: "asc" } });
    expect(signals.map((s) => s.appliedAt)).toEqual(signals.map((s) => s.effectiveDate));
    const findings = await listAll(db, "ResearchFinding", { orderBy: { retrievedAt: "asc" } });
    expect(findings.map((f) => f.retrievedAt)).toEqual([hoursAgo(30), hoursAgo(20)]);
    expect((await getObject(db, "Firm", firm.$primaryKey))?.feeGeneratingCount).toBe(5);
  });

  it("marks a signal for a missing firm applied and writes nothing for it", async () => {
    const db = await createTestDb();
    // The database no longer lets a signal name a firm that is not there; the run still copes with
    // one that does (a database from before the constraint, or one restored without it).
    await db.exec(`ALTER TABLE market_signal DROP CONSTRAINT market_signal_firm_fkey`);
    await addSignal(db, { signalId: "ghost", firmId: "nobody", effectiveDate: hoursAgo(1) });
    expect((await applyDueSignals(db, NOW)).applied).toEqual(["ghost"]);
    expect(await listAll(db, "ResearchFinding")).toHaveLength(0);
    expect((await getObject(db, "MarketSignal", "ghost"))?.appliedAt).toBeDefined();
  });
});
