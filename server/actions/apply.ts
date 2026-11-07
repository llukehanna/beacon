import { randomUUID } from "node:crypto";
import { isActionName } from "../../shared/schema.js";
import { USER } from "../../shared/vocab.js";
import type { Access } from "../access.js";
import { chooseClusterer } from "../clustering/choose.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db } from "../db/client.js";
import { ActionError, HttpError } from "../errors.js";
import { type ActionRunRecorder, recordActionRun } from "../operations/record.js";
import { resolveParams } from "./params.js";
import { ACTIONS } from "./registry.js";
import type { ActionDef, ActionResult } from "./types.js";
import { writeLog } from "./writes.js";

/** Tables that only grow as people use the demo (append-only history and proposals). */
const ACTIVITY_TABLES = [
  "research_finding",
  "qualification_score",
  "review_decision",
  "drift_event",
  "proposed_rule",
  "hard_screen_config",
];
/** About 10× a fresh seed: room to play, but a script can't bloat every page's fetch before the nightly reset. */
export const MAX_ACTIVITY_ROWS = 10_000;

export interface ApplyOptions {
  now?: Date;
  user?: string;
  newId?: (prefix: string) => string;
  clusterer?: Clusterer;
  /** Tests: override MAX_ACTIVITY_ROWS. */
  maxActivityRows?: number;
  /** Where each run's latency is recorded; `null` records nothing (the seed builds history through actions). */
  recordRun?: ActionRunRecorder | null;
  /** Who is acting. Required, so a caller cannot forget the wall: the seed, cron jobs and tests pass NO_WALL. */
  access: Access;
}

const defaultId = (prefix: string): string => `${prefix}-${randomUUID()}`;

/**
 * Validate and run one named action: `prepare` (if any) first, then `run` inside a single transaction.
 * One ActionRun is recorded afterwards, outside that transaction, and a failure to record it never
 * changes what the caller gets back.
 */
export async function applyAction(
  db: Db,
  name: string,
  raw: unknown,
  opts: ApplyOptions,
): Promise<ActionResult> {
  const def = isActionName(name) ? ACTIONS[name] : undefined;
  if (!def) {
    throw new ActionError(`Unknown action "${name}"`, 404);
  }
  const record = opts.recordRun === undefined ? recordActionRun : opts.recordRun;
  const startedAt = new Date();
  const t0 = performance.now();
  const noteRun = async (ok: boolean, errorKind?: string): Promise<void> => {
    if (record === null) {
      return;
    }
    try {
      await record(db, {
        actionName: name,
        startedAt,
        durationMs: performance.now() - t0,
        ok,
        errorKind,
      });
    } catch (e) {
      // Operational signal for the server log: a missing measurement must not fail the action.
      // eslint-disable-next-line no-console
      console.warn(`Could not record the ${name} run.`, e);
    }
  };
  try {
    // `execute` takes the definition with loosely typed params, because `raw` is validated JSON at
    // this boundary. ACTIONS[name] fits only through method-parameter bivariance, so `run` and
    // `prepare` are not checked against this loose type here; they are checked where they are defined.
    const result = await execute(db, def, raw, opts);
    await noteRun(true);
    return result;
  } catch (e) {
    await noteRun(false, e instanceof HttpError ? `http_${e.status}` : "internal");
    throw e;
  }
}

async function execute(
  db: Db,
  def: ActionDef<Record<string, unknown>, unknown>,
  raw: unknown,
  opts: ApplyOptions,
): Promise<ActionResult> {
  const limit = opts.maxActivityRows ?? MAX_ACTIVITY_ROWS;
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT (${ACTIVITY_TABLES.map((t) => `(SELECT count(*) FROM ${t})`).join(" + ")})::int AS n`,
  );
  if (n >= limit) {
    throw new ActionError("The demo has filled up with activity. Reset it to start fresh.", 409);
  }
  const now = opts.now ?? new Date();
  // Outside the transaction: the cost-guard claim must not roll back with the action.
  const clusterer =
    opts.clusterer ?? (def.needsClusterer ? await chooseClusterer(db, now) : undefined);
  const base = {
    now,
    user: opts.user ?? USER,
    newId: opts.newId ?? defaultId,
    clusterer,
    hiddenFirmIds: opts.access.hiddenFirmIds,
  };
  // Outside the transaction too: slow work (the Claude call) must not hold a connection open.
  const prep = def.prepare
    ? await def.prepare(db, await resolveParams(db, def.params, raw, opts.access), base)
    : undefined;
  const writes = writeLog();
  const result = await db.transaction(async (tx) => {
    const params = await resolveParams(tx, def.params, raw, opts.access);
    return def.run({ ...base, tx: writes.track(tx) }, params, prep);
  });
  return { ...result, types: writes.types() };
}
