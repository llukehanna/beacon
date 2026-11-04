import { fixtureClusterer } from "../server/clustering/fixture.js";
import { heuristicClusterer } from "../server/clustering/heuristic.js";
import type { Clusterer } from "../server/clustering/types.js";
import { getDb } from "../server/db/client.js";
import { summarizeFixtures } from "../server/extraction/fixtures.js";
import { resetDemo } from "../server/seed/reset.js";
import { saveSnapshot } from "../server/seed/snapshot.js";
import { generateUniverse } from "../server/seed/universe.js";
import { loadClusteringFixture, loadExtractionFixtureFiles } from "./fixture-files.js";

// Builds the demo through the real actions, then saves it as the snapshot that
// /api/reset and the nightly Cron Trigger restore. Rerun after changing the
// schema or the seed.
// Extraction fixtures (made by `npm run extract`) are loaded into the Extraction table, and the
// clustering fixture (`npm run extract -- --clustering`) stands in for the clusterer when it was
// recorded for these rejections; otherwise the deterministic clusterer runs.
const fixtureFiles = loadExtractionFixtureFiles();
const fixtures = fixtureFiles.flatMap((f) => f.records);
const clustering = loadClusteringFixture();
// A record made against other document text or another prompt version is ignored by the seed, and
// the demo then quietly shows rule-based values. Say so, loudly, per model file.
const universe = new Map(generateUniverse().map((f) => [f.firmId!, f]));
if (fixtureFiles.length === 0) {
  console.log("extraction fixtures: none (every firm is read by the rule-based extractor)");
}
for (const { file, records } of fixtureFiles) {
  const n = summarizeFixtures(records, universe);
  console.log(
    `extraction fixtures ${file}: ${n.current} current, ${n.stale} stale (hash or prompt version), ${n.unusable} without output`,
  );
  if (n.stale > 0) {
    console.warn(
      `WARNING: ${n.stale} stale records in ${file} are ignored. Rerun \`npm run extract\` to refresh them.`,
    );
  }
}
const started = Date.now();
const now = new Date();
const db = await getDb();
// Say how the recording fared: a stale one silently gives way to the deterministic clusterer.
let clusteredBy: "claude" | "heuristic" | null = null; // null: the clusterer never ran
const replay = fixtureClusterer(
  clustering.status === "valid" ? clustering.fixture : null,
  heuristicClusterer,
);
const clusterer: Clusterer = async (rows) => {
  const out = await replay(rows);
  clusteredBy = out.source;
  return out;
};
const { firms } = await resetDemo(db, now, { fixtures, clusterer });
await saveSnapshot(db, now);
const clusteringNote = ((): string => {
  switch (clustering.status) {
    case "absent":
      return "no clustering fixture";
    case "invalid":
      return "clustering fixture is invalid and was ignored";
    case "valid":
      return clusteredBy === "claude"
        ? "clustering fixture used"
        : clusteredBy === "heuristic"
          ? "clustering fixture is stale (recorded for other rejections) and was ignored"
          : "clustering fixture not needed (no rejections to cluster)";
  }
})();
const target = process.env.DATABASE_URL ? "DATABASE_URL" : ".data/pglite";
console.log(
  `Seeded ${firms} firms and their history (${fixtures.length} extraction records, ${clusteringNote}) into ${target}, and saved the reset snapshot, in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
await db.close();
