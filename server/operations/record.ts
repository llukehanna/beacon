/**
 * Writes the operations metrics. Each write is a measurement of the app, not part of what an
 * action does: callers run it outside the action's transaction and treat a failure as "not recorded".
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/client.js";

/** Ceiling on stored action runs, so a script of failing requests cannot grow the table until the nightly reset. */
export const MAX_ACTION_RUNS = 10_000;

export interface ActionRunInput {
  actionName: string;
  startedAt: Date;
  durationMs: number;
  ok: boolean;
  errorKind?: string;
}

export type ActionRunRecorder = (q: Queryable, run: ActionRunInput) => Promise<void>;

export const recordActionRun: ActionRunRecorder = async (q, run) => {
  await q.query(
    `INSERT INTO action_run ("actionRunId", "actionName", "startedAt", "durationMs", "ok", "errorKind")
     SELECT $1::text, $2::text, $3::timestamptz, $4::int, $5::boolean, $6::text
     WHERE (SELECT count(*) FROM action_run) < $7::int`,
    [
      `run-${randomUUID()}`,
      run.actionName,
      run.startedAt.toISOString(),
      Math.round(run.durationMs),
      run.ok,
      run.errorKind ?? null,
      MAX_ACTION_RUNS,
    ],
  );
};

export interface ModelCallInput {
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calledAt: Date;
}

export async function recordModelCall(q: Queryable, call: ModelCallInput): Promise<void> {
  await q.query(
    `INSERT INTO model_call ("modelCallId", "purpose", "model", "inputTokens", "outputTokens", "costUsd", "calledAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      `call-${randomUUID()}`,
      call.purpose,
      call.model,
      call.inputTokens,
      call.outputTokens,
      call.costUsd,
      call.calledAt.toISOString(),
    ],
  );
}
