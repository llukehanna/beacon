import { getDb } from "../server/db/client.js";
import { claimWindow, getMeta } from "../server/db/meta.js";
import { json, jsonError } from "../server/http.js";
import { resetFromSnapshot } from "../server/seed/snapshot.js";

const COOLDOWN_MS = 5 * 60_000;

/**
 * Restore the shared demo from its snapshot (built by `npm run seed`).
 * Resetting is already public (the demo bar has a button), so there is no
 * secret; one throttle protects both callers.
 */
async function throttledReset(): Promise<Response> {
  try {
    const db = await getDb();
    // One atomic claim, before the reset: concurrent resets would interleave and half-restore the demo.
    if (!(await claimWindow(db, "lastResetAt", new Date(), COOLDOWN_MS))) {
      return json({ error: "The demo was reset in the last few minutes. Try again shortly." }, 429);
    }
    const claimedAt = await getMeta(db, "lastResetAt");
    try {
      return json(await resetFromSnapshot(db));
    } catch (e) {
      // The reset rolled back; free the slot so it can be retried right away.
      await db.query(`DELETE FROM meta WHERE key = 'lastResetAt' AND value = $1`, [claimedAt]);
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Reset over GET (the nightly Cron Trigger calls the reset directly). When
 * CRON_SECRET is set, GET requires it as a bearer token, which keeps crawlers
 * and link prefetchers from resetting the demo.
 */
export async function GET(request?: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request?.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  return throttledReset();
}

/** The demo bar's Reset button. */
export function POST(): Promise<Response> {
  return throttledReset();
}
