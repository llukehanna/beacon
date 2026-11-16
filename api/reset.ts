import { getDb } from "../server/db/client.js";
import { claimWindow, getMeta, setMeta } from "../server/db/meta.js";
import { assertSameOrigin, json, jsonError } from "../server/http.js";
import { resetFromSnapshot } from "../server/seed/snapshot.js";

const COOLDOWN_MS = 5 * 60_000;

/** The meta key holding why the latest reset failed, until a reset succeeds. */
const RESET_ERROR = "lastResetError";

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
    const lastGood = await getMeta(db, "lastResetAt");
    // One atomic claim, before the reset: concurrent resets would interleave and half-restore the demo.
    if (!(await claimWindow(db, "lastResetAt", new Date(), COOLDOWN_MS))) {
      return json({ error: "The demo was reset in the last few minutes. Try again shortly." }, 429);
    }
    const claimedAt = await getMeta(db, "lastResetAt");
    try {
      const restored = await resetFromSnapshot(db);
      await db.query(`DELETE FROM meta WHERE key = $1`, [RESET_ERROR]);
      return json(restored);
    } catch (e) {
      // The reset rolled back. Put back when the last good reset ran, which the Operations window,
      // the idle reset and the live check all read (and which frees the slot for a retry right
      // away: the claim succeeded, so it is older than the cooldown), and keep why it failed.
      await db.query(
        lastGood === null
          ? `DELETE FROM meta WHERE key = 'lastResetAt' AND value = $1`
          : `UPDATE meta SET value = $2, "updatedAt" = now() WHERE key = 'lastResetAt' AND value = $1`,
        lastGood === null ? [claimedAt] : [claimedAt, lastGood],
      );
      const message = e instanceof Error ? e.message : String(e);
      await setMeta(db, RESET_ERROR, JSON.stringify({ at: new Date().toISOString(), message }));
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
