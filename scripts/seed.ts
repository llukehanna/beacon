import { fixtureClusterer } from "../server/clustering/fixture.js";
import { heuristicClusterer } from "../server/clustering/heuristic.js";
import type { Clusterer } from "../server/clustering/types.js";
import { getDb } from "../server/db/client.js";
import { resetDemo } from "../server/seed/reset.js";
import { saveSnapshot } from "../server/seed/snapshot.js";
import { loadClusteringFixture, loadExtractionFixtures } from "./fixture-files.js";

// Builds the demo through the real actions, then saves it as the snapshot that
// /api/reset and the nightly Cron Trigger restore. Rerun after changing the
// schema or the seed.
// Extraction fixtures (made by `npm run extract`) are loaded into the Extraction table, and the
// clustering fixture (`npm run extract -- --clustering`) stands in for the clusterer when it was
// recorded for these rejections; otherwise the deterministic clusterer runs.
const fixtures = loadExtractionFixtures();
const clustering = loadClusteringFixture();
const started = Date.now();
const now = new Date();
const db = await getDb();
// Say whether the recording applied: a stale one silently gives way to the deterministic clusterer.
let replayed = false;
const replay = fixtureClusterer(clustering, heuristicClusterer);
const clusterer: Clusterer = async (rows) => {
  const out = await replay(rows);
  replayed = out.source === "claude";
  return out;
};
const { firms } = await resetDemo(db, now, { fixtures, clusterer });
await saveSnapshot(db, now);
const target = process.env.DATABASE_URL ? "DATABASE_URL" : ".data/pglite";
console.log(
  `Seeded ${firms} firms and their history (${fixtures.length} extraction records, ${clustering ? (replayed ? "clustering fixture used" : "clustering fixture is stale and was ignored") : "no clustering fixture"}) into ${target}, and saved the reset snapshot, in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
await db.close();
