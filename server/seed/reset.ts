import type { Props } from "../../shared/schema.js";
import type { ApplyOptions } from "../actions/apply.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db, Queryable } from "../db/client.js";
import { OBJECT_TABLES, ensureSchema } from "../db/ddl.js";
import { setMeta } from "../db/meta.js";
import { insertObjects } from "../db/repo.js";
import { type FixtureRecord, fixtureToExtractionRows } from "../extraction/fixtures.js";
import { seedHistory } from "./history.js";
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

/**
 * Wipe every object table and rebuild the demo world in one transaction:
 * readers see the old world or the new one, never a half-seeded mix, and a
 * failure or timeout rolls back cleanly. It also saves a BEGIN/COMMIT round
 * trip per seeded action. `fixtures` are extraction records (from `fixtures/extraction`); their
 * rows go in right after the firms, so the agent's enrichment in the seeded history reads them.
 * `clusterer` replaces the deterministic one that groups the seeded rejections (a recorded Claude reply).
 */
export async function resetDemo(
  db: Db,
  now: Date = new Date(),
  opts: Pick<ApplyOptions, "newId"> & { fixtures?: FixtureRecord[]; clusterer?: Clusterer } = {},
): Promise<{ firms: number }> {
  await ensureSchema(db);
  const universe = generateUniverse();
  const firmsById = new Map(universe.map((f) => [f.firmId, f]));
  // Keyed by id so a repeated record for one firm and model replaces the earlier one.
  const extractions = new Map<string, Props<"Extraction">>();
  for (const record of opts.fixtures ?? []) {
    const firm = firmsById.get(record.firmId);
    for (const row of firm ? fixtureToExtractionRows(record, firm, now) : []) {
      extractions.set(row.extractionId!, row);
    }
  }
  await db.transaction(async (tx) => {
    await tx.query(`TRUNCATE ${[...OBJECT_TABLES, "search_list_firm"].join(", ")}`);
    await insertObjects(tx, "Firm", universe);
    await insertObjects(tx, "Extraction", [...extractions.values()]);
    await seedHistory(joined(tx, db), new Date(now.getTime() - HISTORY_DAYS * 86_400_000), opts);
  });
  await setMeta(db, "lastResetAt", now.toISOString());
  return { firms: universe.length };
}
