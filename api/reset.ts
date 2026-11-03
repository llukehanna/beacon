import { getDb } from "../server/db/client.js";
import { claimWindow, getMeta } from "../server/db/meta.js";
import { assertSameOrigin, json, jsonError } from "../server/http.js";
import { resetFromSnapshot } from "../server/seed/snapshot.js";

const COOLDOWN_MS = 5 * 60_000;

/**
 * Restore the shared demo from its snapshot (built by `npm run seed`).
 * Resetting is already public (the demo bar has a button), so there is no
 * secret; one throttle protects the button and the nightly Cron Trigger,
 * which calls POST directly rather than over HTTP.
 */
async function throttledReset(request?: Request): Promise<Response> {
  try {
    if (request) {
      assertSameOrigin(request); // Any page can POST here cross-site; the cron passes no request.
    }
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

/** The demo bar's Reset button, and the nightly Cron Trigger. */
export function POST(request?: Request): Promise<Response> {
  return throttledReset(request);
}
