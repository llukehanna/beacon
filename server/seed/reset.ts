import type { Props } from "../../shared/schema.js";
import type { ApplyOptions } from "../actions/apply.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db, Queryable } from "../db/client.js";
import { OBJECT_TABLES, ensureSchema } from "../db/ddl.js";
import { setMeta } from "../db/meta.js";
import { insertObjects } from "../db/repo.js";
import { type FixtureRecord, fixtureToExtractionRows } from "../extraction/fixtures.js";
import { seedHistory } from "./history.js";
import { seedSignals } from "./signals.js";
import { latestTimestampMs, shiftLiveTimestamps } from "./snapshot.js";
import { generateUniverse } from "./universe.js";

export const HISTORY_DAYS = 30;

/** A Db whose transactions join an enclosing one, so the real action handlers can run inside it. */
function joined(tx: Queryable, db: Db): Db {
  return {
    query: (sql, params) => tx.query(sql, params),
    exec: () =>
      Promise.reject(
        new Error("exec (multi-statement SQL) is not available inside the reset transaction"),
      ),
    transaction: (fn) => fn(tx),
    close: () => db.close(),
  };
}

/** Ids for what the seeded signals write: the same on every run, and apart from the history's own. */
function signalIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-seed-signal-${String(++n).padStart(5, "0")}`;
}

/**
 * Wipe every object table and rebuild the demo world in one transaction:
 * readers see the old world or the new one, never a half-seeded mix, and a
 * failure or timeout rolls back cleanly. It also saves a BEGIN/COMMIT round
 * trip per seeded action. The history is built on its own advancing clock and then moved as
 * a whole so its last event lands at `now` (a demo whose latest activity reads "2w ago" looks
 * abandoned). `fixtures` are extraction records (from `fixtures/extraction`); their
 * rows go in right after the firms, so the agent's enrichment in the seeded history reads them.
 * `clusterer` replaces the deterministic one that groups the seeded rejections (a recorded Claude reply).
 */
export async function resetDemo(
  db: Db,
  now: Date = new Date(),
  opts: Pick<ApplyOptions, "newId"> & { fixtures?: FixtureRecord[]; clusterer?: Clusterer } = {},
): Promise<{ firms: number }> {
  await ensureSchema(db);
  const historyStart = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const universe = generateUniverse();
  const firmsById = new Map(universe.map((f) => [f.firmId, f]));
  // Keyed by id so a repeated record for one firm and model replaces the earlier one.
  const extractions = new Map<string, Props<"Extraction">>();
  for (const record of opts.fixtures ?? []) {
    const firm = firmsById.get(record.firmId);
    for (const row of firm ? fixtureToExtractionRows(record, firm, historyStart) : []) {
      extractions.set(row.extractionId!, row);
    }
  }
  await db.transaction(async (tx) => {
    await tx.query(`TRUNCATE ${[...OBJECT_TABLES, "search_list_firm"].join(", ")}`);
    await insertObjects(tx, "Firm", universe);
    await insertObjects(tx, "Extraction", [...extractions.values()]);
    await seedHistory(joined(tx, db), historyStart, opts);
    // The history's clock advances by minutes per action, so it ends days before `now`.
    // Move the whole world forward so its last event lands at `now`: relative order and
    // spacing are unchanged, and the snapshot taken at `now` restores to the same picture.
    const latest = await latestTimestampMs(tx);
    if (latest !== null) {
      await tx.query(`SET LOCAL TIME ZONE 'UTC'`);
      await shiftLiveTimestamps(tx, now.getTime() - latest);
    }
    // Market signals come last, dated around `now`: those already due are applied as history, the
    // rest wait in the snapshot for the hourly run. (They are added after the shift, which would
    // otherwise treat the signals still to come as the latest event and move the history to them.)
    await seedSignals(joined(tx, db), now, opts.newId ?? signalIds());
  });
  await setMeta(db, "lastResetAt", now.toISOString());
  return { firms: universe.length };
}
