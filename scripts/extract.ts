import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assignCustomIds, planChunks, selectFirmsToExtract } from "../server/extraction/budget.js";
import {
  EXTRACTION_PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseExtraction,
} from "../server/extraction/contract.js";
import { documentsHash, firmDocuments } from "../server/extraction/documents.js";
import { type FixtureRecord, parseFixtureLines } from "../server/extraction/fixtures.js";
import { groundExtraction } from "../server/extraction/grounding.js";
import {
  PRICES,
  costFromUsage,
  estimateFirmCostUsd,
  systemPromptCaches,
} from "../server/extraction/pricing.js";
import { generateUniverse } from "../server/seed/universe.js";
import { firmModel } from "../shared/scoring.js";

// Reads every firm's four mock source documents with Claude and appends one JSONL line per firm to
// fixtures/extraction/<model>.jsonl, which the seed loads. Resumable: a firm with a current line
// is skipped, so a rerun only pays for what is missing. --max-usd caps one run's spend; no batch
// is submitted whose estimate would pass it.

const MAX_TOKENS = 1500;
const POLL_MS = 30_000;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        model: { type: "string", default: "claude-haiku-4-5" },
        "max-usd": { type: "string", default: "5" },
        sample: { type: "string" },
        chunk: { type: "string", default: "100" },
        sync: { type: "boolean", default: false },
        clustering: { type: "boolean", default: false },
      },
    });
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : "Invalid arguments."}`, 2);
  }
})();

const positive = (name: string, raw: string | undefined, integer: boolean): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    return fail(`--${name} must be a positive ${integer ? "integer" : "number"}, got "${raw}".`, 2);
  }
  return n;
};

const model = values.model;
const maxUsd = positive("max-usd", values["max-usd"], false) ?? 5;
const sample = positive("sample", values.sample, true);
const chunkSize = positive("chunk", values.chunk, true) ?? 100;
const sync = values.sync;

if (!/^[A-Za-z0-9._-]+$/.test(model)) {
  fail(`--model "${model}" is not a model id.`, 2);
}
if (!PRICES[model]) {
  fail(`No price for model "${model}". Add it to PRICES in server/extraction/pricing.ts.`, 2);
}
if (values.clustering) {
  fail("--clustering is not available yet; it arrives with the showcase seed.", 2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  fail(
    "ANTHROPIC_API_KEY is not set. Export it (or add it as a repository secret for the workflow) and rerun.",
  );
}

const client = new Anthropic();
const fixtureFile = fileURLToPath(
  new URL(`../fixtures/extraction/${model}.jsonl`, import.meta.url),
);

const firms = generateUniverse();
const prepared = new Map(
  firms.map((firm) => {
    const docs = firmDocuments(firm);
    const user = buildUserMessage(docs, firmModel(firm));
    return [firm.firmId!, { firm, docs, hash: documentsHash(docs), user }] as const;
  }),
);

const existing = existsSync(fixtureFile)
  ? parseFixtureLines(readFileSync(fixtureFile, "utf8"))
  : [];
const selected = selectFirmsToExtract([...prepared.keys()], existing, {
  model,
  sample,
  hashes: new Map([...prepared].map(([id, p]) => [id, p.hash])),
});
console.log(
  `${selected.length} of ${prepared.size} firms to extract with ${model} (${sync ? "sync" : "batch"}); cap $${maxUsd.toFixed(2)}.`,
);
console.log(
  systemPromptCaches(model, SYSTEM_PROMPT.length)
    ? "System prompt is long enough to cache; estimates assume cache reads."
    : "System prompt is below the model's minimum cacheable length; estimates assume no cache reads.",
);

const estimate = (id: string): number =>
  estimateFirmCostUsd(model, prepared.get(id)!.user.length, SYSTEM_PROMPT.length, !sync);

const request = (id: string) => ({
  model,
  max_tokens: MAX_TOKENS,
  system: [
    { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
  ],
  messages: [{ role: "user" as const, content: prepared.get(id)!.user }],
});

interface Reply {
  text: string;
  usage: FixtureRecord["usage"];
  latencyMs: number | null;
  batchId: string | null;
}

const usageOf = (u: Anthropic.Usage): FixtureRecord["usage"] => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
});

const textOf = (message: Anthropic.Message): string =>
  message.content.map((b) => (b.type === "text" ? b.text : "")).join("");

/** Never print more than the error's status and message: no headers, no key. */
const describe = (err: unknown): string =>
  err instanceof Anthropic.APIError
    ? `${err.name} (${err.status ?? "no status"}): ${err.message}`
    : "unexpected error";

/** One Message Batch for the chunk. Firms whose request did not succeed get no reply (and no charge). */
async function runBatch(chunk: string[]): Promise<Map<string, Reply>> {
  const customIds = assignCustomIds(chunk);
  const byFirm = new Map([...customIds].map(([customId, firmId]) => [firmId, customId]));
  const batch = await client.messages.batches.create({
    requests: chunk.map((id) => ({ custom_id: byFirm.get(id)!, params: request(id) })),
  });
  console.log(
    `  batch ${batch.id} submitted (${chunk.length} firms); polling every ${POLL_MS / 1000}s.`,
  );
  let status = batch.processing_status;
  while (status !== "ended") {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    status = (await client.messages.batches.retrieve(batch.id)).processing_status;
  }
  const replies = new Map<string, Reply>();
  let notSucceeded = 0;
  for await (const entry of await client.messages.batches.results(batch.id)) {
    const firmId = customIds.get(entry.custom_id);
    if (firmId === undefined) {
      continue;
    }
    if (entry.result.type !== "succeeded") {
      notSucceeded++;
      continue;
    }
    const message = entry.result.message;
    replies.set(firmId, {
      text: textOf(message),
      usage: usageOf(message.usage),
      latencyMs: null,
      batchId: batch.id,
    });
  }
  if (notSucceeded > 0) {
    console.log(
      `  ${notSucceeded} requests errored, expired, or were canceled; a rerun retries them.`,
    );
  }
  return replies;
}

/** The chunk one call at a time, timing each. */
async function runSync(chunk: string[]): Promise<Map<string, Reply>> {
  const replies = new Map<string, Reply>();
  for (const id of chunk) {
    const started = performance.now();
    try {
      const message = await client.messages.create(request(id));
      replies.set(id, {
        text: textOf(message),
        usage: usageOf(message.usage),
        latencyMs: Math.round(performance.now() - started),
        batchId: null,
      });
    } catch (err) {
      console.log(`  ${id}: ${describe(err)}; a rerun retries it.`);
    }
  }
  return replies;
}

let extracted = 0;
let parsed = 0;
let groundedItems = 0;
let totalItems = 0;
let spent = 0;
let remaining = selected;
let stopped = false;
// Actual cost over estimated cost on the previous chunk; planning never assumes it is below 1.
let calibration = 1;

mkdirSync(fileURLToPath(new URL("../fixtures/extraction/", import.meta.url)), { recursive: true });

try {
  while (remaining.length > 0) {
    const { chunks } = planChunks(
      remaining,
      (id) => estimate(id) * calibration,
      maxUsd,
      spent,
      chunkSize,
    );
    const chunk = chunks[0];
    if (!chunk) {
      break;
    }
    console.log(
      `Chunk of ${chunk.length} firms (spent $${spent.toFixed(4)} of $${maxUsd.toFixed(2)}).`,
    );
    const replies = sync ? await runSync(chunk) : await runBatch(chunk);

    const lines: string[] = [];
    let chunkCost = 0;
    for (const id of chunk) {
      const reply = replies.get(id);
      if (!reply) {
        continue;
      }
      const { firm, docs, hash } = prepared.get(id)!;
      const output = parseExtraction(reply.text);
      const costUsd = costFromUsage(model, reply.usage, !sync);
      const record: FixtureRecord = {
        firmId: id,
        model,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        documentsHash: hash,
        createdAt: new Date().toISOString(),
        output,
        usage: reply.usage,
        costUsd,
        latencyMs: reply.latencyMs,
        batchId: reply.batchId,
      };
      lines.push(JSON.stringify(record));
      chunkCost += costUsd;
      extracted++;
      if (output) {
        parsed++;
        const result = groundExtraction(firm, docs, output, model);
        groundedItems += result.observations.length;
        totalItems += result.observations.length + result.rejected.length;
      }
    }
    if (lines.length > 0) {
      appendFileSync(fixtureFile, `${lines.join("\n")}\n`);
    }
    const estimated = chunk.reduce((sum, id) => sum + estimate(id), 0);
    calibration = Math.max(1, chunkCost / estimated);
    spent += chunkCost;
    remaining = remaining.slice(chunk.length);
    console.log(
      `  wrote ${lines.length} lines; chunk cost $${chunkCost.toFixed(4)} (estimated $${estimated.toFixed(4)}).`,
    );
  }
} catch (err) {
  console.error(`Stopped: ${describe(err)}. Lines already written are kept; rerun to resume.`);
  stopped = true;
  process.exitCode = 1;
}

const rate = totalItems === 0 ? "n/a" : `${((100 * groundedItems) / totalItems).toFixed(1)}%`;
console.log(
  [
    `Firms extracted: ${extracted}`,
    `Firms parsed: ${parsed}`,
    `Grounding rate: ${rate} (${groundedItems} of ${totalItems} items)`,
    `Total cost: $${spent.toFixed(4)}`,
    `Skipped for budget: ${stopped ? 0 : remaining.length}`,
    ...(stopped ? [`Not attempted after the error: ${remaining.length}`] : []),
  ].join("\n"),
);
