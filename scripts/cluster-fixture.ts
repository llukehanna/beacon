import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLUSTER_MODEL, createClaudeClusterer } from "../server/clustering/claude.js";
import { type ClusteringFixture, hashRejections } from "../server/clustering/fixture.js";
import type { Clusterer } from "../server/clustering/types.js";
import { createPgliteDb } from "../server/db/client.js";
import { resetDemo } from "../server/seed/reset.js";
import { clusteringFile, loadExtractionFixtures } from "./fixture-files.js";

// US$ per million tokens (input, output), from the claude-api skill's model table (read 2026-11-04).
const CLUSTER_PRICES: Readonly<Record<string, readonly [number, number]>> = {
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
};

/**
 * Seeds an in-memory demo with a clusterer that makes the one Claude call and records its reply,
 * then writes it to fixtures/clustering/clusters.json. The seed (`npm run seed`) replays it when
 * the rejections it clusters are the ones recorded here. This uses the same extraction fixtures
 * as the seed, because they decide which values the seeded analyst accepts, and so which
 * rejections exist. Separate from the extraction run: no batch, no cap, and one call's cost.
 */
export async function recordClustering(): Promise<void> {
  const real = new Anthropic({ timeout: 300_000, maxRetries: 1 });
  const state: {
    usage: { input: number; output: number } | null;
    model: string;
    recorded: Pick<ClusteringFixture, "inputHash" | "proposals"> | null;
  } = { usage: null, model: CLUSTER_MODEL, recorded: null };
  // The clusterer only calls `beta.messages.create`; this wrapper keeps the usage it reports.
  const client = {
    beta: {
      messages: {
        create: async (request: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
          const message = await real.beta.messages.create(request);
          state.usage = {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
          };
          state.model = message.model;
          return message;
        },
      },
    },
  } as unknown as Anthropic;

  const claude = createClaudeClusterer(client);
  const clusterer: Clusterer = async (rows) => {
    if (state.recorded !== null) {
      throw new Error("Clustering ran twice; it is meant to be one call.");
    }
    const out = await claude(rows);
    state.recorded = { inputHash: hashRejections(rows), proposals: out.proposals };
    return out;
  };

  const db = await createPgliteDb();
  try {
    await resetDemo(db, new Date(), { fixtures: loadExtractionFixtures(), clusterer });
  } finally {
    await db.close();
  }
  const { recorded, usage, model: answeredBy } = state;
  if (recorded === null) {
    throw new Error("The seed produced no rejections to cluster, so there is nothing to record.");
  }
  const { inputHash, proposals } = recorded;
  const fixture: ClusteringFixture = {
    inputHash,
    model: answeredBy,
    proposals,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(clusteringFile), { recursive: true });
  writeFileSync(clusteringFile, `${JSON.stringify(fixture, null, 2)}\n`);

  const price = Object.entries(CLUSTER_PRICES).find(([model]) => answeredBy === model)?.[1];
  const u = usage;
  console.log(
    [
      `Clustering fixture written: ${proposals.length} proposals by ${answeredBy}, input ${inputHash}.`,
      u === null
        ? "Cost: not reported."
        : price === undefined
          ? `Cost: no price for ${answeredBy}; ${u.input} input and ${u.output} output tokens.`
          : `Cost: $${((u.input * price[0] + u.output * price[1]) / 1_000_000).toFixed(4)} (${u.input} input and ${u.output} output tokens at ${answeredBy} rates).`,
    ].join("\n"),
  );
}
