import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ClusteringFixture, parseClusteringFixture } from "../server/clustering/fixture.js";
import { type FixtureRecord, parseFixtureLines } from "../server/extraction/fixtures.js";

// The recorded Claude output the seed replays. Read only here, by Node scripts: nothing under
// worker/ or api/ touches the filesystem.
const extractionDir = fileURLToPath(new URL("../fixtures/extraction/", import.meta.url));
export const clusteringFile = fileURLToPath(
  new URL("../fixtures/clustering/clusters.json", import.meta.url),
);

export function loadExtractionFixtures(): FixtureRecord[] {
  return existsSync(extractionDir)
    ? readdirSync(extractionDir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .flatMap((f) => parseFixtureLines(readFileSync(`${extractionDir}${f}`, "utf8")))
    : [];
}

export function loadClusteringFixture(): ClusteringFixture | null {
  return existsSync(clusteringFile)
    ? parseClusteringFixture(readFileSync(clusteringFile, "utf8"))
    : null;
}
