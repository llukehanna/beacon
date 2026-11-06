/**
 * Apply the market signals that have come due. The hourly Cron Trigger and the nightly reset call
 * `applyDueSignals`; the seed calls it with `backfill` to apply the signals dated before the seed.
 *
 * One transaction per run. It claims at most `limit` unapplied signals whose date has passed
 * (FOR UPDATE SKIP LOCKED, so two runs never take the same one), asks the pure planner
 * (server/signals/apply.ts) what each one writes, writes it, and sets `appliedAt`. A signal with
 * `appliedAt` set is never claimed again, so a second run over the same signals changes nothing.
 * The claim is one indexed query and each run touches only the firms its signals name, which keeps
 * a run well inside a Cloudflare Worker's free-plan CPU budget.
 */
import { randomUUID } from "node:crypto";
import { SYNTHETIC_LABEL } from "../../shared/marketSignals.js";
import { OBJECT_TYPES } from "../../shared/schema.js";
import { snapshotScore } from "../actions/common.js";
import { computeDriftForFirm, openOutcomeDivergence } from "../actions/drift.js";
import type { ActionContext } from "../actions/types.js";
import type { Db, Queryable } from "../db/client.js";
import { getObject, insertObject, toWire, updateObject } from "../db/repo.js";
import { type FirmState, type SignalPlan, type SignalRow, planSignals } from "./apply.js";

/** The most signals one run applies, so a backlog never makes one cron run heavy. */
export const MAX_SIGNALS_PER_RUN = 10;

/** Who the records of an applied signal name as their author. */
export const SIGNAL_USER = "market-signal";

export interface ApplyOptions {
  /** Defaults to MAX_SIGNALS_PER_RUN; the seed passes Infinity to apply its whole backlog. */
  limit?: number;
  /** Stamp each signal's records and appliedAt with its own date, as if a run had come on time. */
  backfill?: boolean;
  newId?: (prefix: string) => string;
}

export interface ApplyResult {
  /** The signals applied, oldest first. */
  applied: string[];
  /** The DriftEvents the signals opened. */
  drifts: string[];
}

const defaultId = (prefix: string): string => `${prefix}-${randomUUID()}`;

/** Write what each plan says; returns the DriftEvents it opened. A skipped signal writes nothing. */
async function write(
  tx: Queryable,
  plans: readonly SignalPlan[],
  newId: (prefix: string) => string,
): Promise<string[]> {
  const drifts: string[] = [];
  for (const plan of plans) {
    if (plan.skipped !== null) {
      continue;
    }
    const ctx: ActionContext = { tx, now: new Date(plan.at), user: SIGNAL_USER, newId };
    if (plan.firmPatch !== null) {
      await updateObject(tx, "Firm", plan.firmId, plan.firmPatch);
    }
    if (plan.finding !== null) {
      await insertObject(tx, "ResearchFinding", { ...plan.finding, findingId: newId("rf") });
    }
    if (plan.after.total !== plan.before.total) {
      const firm = (await getObject(tx, "Firm", plan.firmId))!;
      await snapshotScore(ctx, firm, "marketSignal");
    }
    if (plan.checkTier) {
      const drift = await computeDriftForFirm(ctx, plan.firmId, { source: SYNTHETIC_LABEL });
      if (drift !== null) {
        drifts.push(drift);
      }
    }
    if (plan.openOutcomeDrift) {
      const firm = (await getObject(tx, "Firm", plan.firmId))!;
      const drift = await openOutcomeDivergence(ctx, firm);
      if (drift !== null) {
        drifts.push(drift);
      }
    }
  }
  return drifts;
}

/** Apply the signals due at `now`, at most `limit` of them, in one transaction. */
export async function applyDueSignals(
  db: Db,
  now: Date = new Date(),
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const limit = opts.limit ?? MAX_SIGNALS_PER_RUN;
  const newId = opts.newId ?? defaultId;
  return db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `SELECT * FROM ${OBJECT_TYPES.MarketSignal.table}
        WHERE "appliedAt" IS NULL AND "effectiveDate" <= $1
        ORDER BY "effectiveDate", "signalId"
        LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [now.toISOString(), Number.isFinite(limit) ? limit : 100000],
    );
    if (rows.length === 0) {
      return { applied: [], drifts: [] };
    }
    const signals = rows.map((r) => toWire("MarketSignal", r) as unknown as SignalRow);
    const firmIds = [...new Set(signals.map((s) => s.firmId))].sort();
    const firmRows = await tx.query<Record<string, unknown>>(
      `SELECT * FROM ${OBJECT_TYPES.Firm.table} WHERE "firmId" = ANY($1::text[]) ORDER BY "firmId" FOR UPDATE`,
      [firmIds],
    );
    const firms = new Map<string, FirmState>(
      firmRows.map((r) => [String(r.firmId), toWire("Firm", r) as FirmState]),
    );
    const at = (s: SignalRow): string => (opts.backfill ? s.effectiveDate : now.toISOString());
    const plans = planSignals(signals, firms, at);
    const drifts = await write(tx, plans, newId);
    await tx.query(
      `UPDATE ${OBJECT_TYPES.MarketSignal.table}
          SET "appliedAt" = ${opts.backfill ? `"effectiveDate"` : "$2"}
        WHERE "signalId" = ANY($1::text[]) AND "appliedAt" IS NULL`,
      opts.backfill
        ? [signals.map((s) => s.signalId)]
        : [signals.map((s) => s.signalId), now.toISOString()],
    );
    return { applied: signals.map((s) => s.signalId), drifts };
  });
}
