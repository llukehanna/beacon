/**
 * The idle reset. The demo is shared: what one visitor does, every later visitor sees until the
 * nightly reset. So the hourly run also restores the seeded world once the demo has been changed and
 * then left alone: a visitor who arrives after a quiet spell finds it as seeded, and nobody in the
 * middle of a session loses their work.
 */
import type { Queryable } from "../db/client.js";
import { getMeta } from "../db/meta.js";

/** How long the demo must sit untouched after a visitor's change before the hourly run restores it. */
export const IDLE_RESET_MS = 30 * 60 * 1000;

/**
 * True when an action succeeded since the last reset and none has run for `idleMs`. Only actions
 * count: every write a visitor makes is an action and records an ActionRun, which the reset clears,
 * while the hourly market signals record none. A failed action wrote nothing, so it does not count.
 */
export async function changedThenIdle(
  q: Queryable,
  now: Date,
  idleMs: number = IDLE_RESET_MS,
): Promise<boolean> {
  const lastReset = await getMeta(q, "lastResetAt");
  if (lastReset === null) {
    return false;
  }
  const [row] = await q.query<{ last: string | null }>(
    `SELECT max("startedAt")::text AS last FROM action_run WHERE ok AND "startedAt" > $1::timestamptz`,
    [lastReset],
  );
  if (!row?.last) {
    return false;
  }
  return now.getTime() - new Date(row.last).getTime() >= idleMs;
}
