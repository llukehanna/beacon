import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/client.js";
import { parseFixtureLines } from "../server/extraction/fixtures.js";
import { resetDemo } from "../server/seed/reset.js";
import { saveSnapshot } from "../server/seed/snapshot.js";

// Builds the demo through the real actions, then saves it as the snapshot that
// /api/reset and the nightly Cron Trigger restore. Rerun after changing the
// schema or the seed.
// Extraction fixtures (made by `npm run extract`) are loaded into the Extraction table.
const fixtureDir = fileURLToPath(new URL("../fixtures/extraction/", import.meta.url));
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".jsonl"))
  .sort()
  .flatMap((f) => parseFixtureLines(readFileSync(`${fixtureDir}${f}`, "utf8")));
const started = Date.now();
const now = new Date();
const db = await getDb();
const { firms } = await resetDemo(db, now, { fixtures });
await saveSnapshot(db, now);
const target = process.env.DATABASE_URL ? "DATABASE_URL" : ".data/pglite";
console.log(
  `Seeded ${firms} firms and their history (${fixtures.length} extraction records) into ${target}, and saved the reset snapshot, in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
await db.close();
