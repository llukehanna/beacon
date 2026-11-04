import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  FIRST_CHUNK_MAX,
  assignCustomIds,
  planChunks,
  selectFirmsToExtract,
  withRetry,
} from "../server/extraction/budget.js";
import {
  EXTRACTION_PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseExtraction,
} from "../server/extraction/contract.js";
import { documentsHash, firmDocuments } from "../server/extraction/documents.js";
import {
  type FixtureRecord,
  parseFixtureLines,
  planFixtureRepair,
} from "../server/extraction/fixtures.js";
import { groundExtraction } from "../server/extraction/grounding.js";
import {
  costFromUsage,
  estimateFirmCostUsd,
  hasPrice,
  systemPromptCaches,
} from "../server/extraction/pricing.js";
import { generateUniverse } from "../server/seed/universe.js";
import { firmModel } from "../shared/scoring.js";
import { recordClustering } from "./cluster-fixture.js";

// `--clustering` instead records the one Claude call that groups the seeded rejections into rule
// proposals, as fixtures/clustering/clusters.json (see scripts/cluster-fixture.ts).
//
// Reads every firm's four mock source documents with Claude and appends one JSONL line per firm to
// fixtures/extraction/<model>.jsonl, which the seed loads. Resumable: a firm with a current line
// is skipped, so a rerun only pays for what is missing. --max-usd caps one run's spend; no batch
// is submitted whose worst-case estimate (every reply at max_tokens) would pass it.
//
// A batch is paid for once it is submitted, so its id is printed at once. If a run stops before the
// results are written, rerun with --resume-batch <id> (and the same --model) to collect that batch
// instead of paying for the same firms again.

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
        "resume-batch": { type: "string" },
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
const resumeBatch = values["resume-batch"]?.trim() || undefined;

if (!/^[A-Za-z0-9._-]+$/.test(model)) {
  fail(`--model "${model}" is not a model id.`, 2);
}
if (!hasPrice(model)) {
  fail(`No price for model "${model}". Add it to PRICES in server/extraction/pricing.ts.`, 2);
}
if (resumeBatch !== undefined && (sync || !/^msgbatch_[A-Za-z0-9]+$/.test(resumeBatch))) {
  fail("--resume-batch takes a batch id (msgbatch_...) and cannot be combined with --sync.", 2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  fail(
    "ANTHROPIC_API_KEY is not set. Export it (or add it as a repository secret for the workflow) and rerun.",
  );
}
if (values.clustering) {
  // One Claude call on the seeded rejections, written to fixtures/clustering/clusters.json.
  try {
    await recordClustering();
  } catch (err) {
    fail(
      `Clustering failed: ${err instanceof Error ? `${err.name}: ${err.message}` : "unexpected error"}`,
    );
  }
  process.exit(0);
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

const hashes = new Map([...prepared].map(([id, p]) => [id, p.hash]));
mkdirSync(fileURLToPath(new URL("../fixtures/extraction/", import.meta.url)), { recursive: true });

// A run killed mid-write can leave a partial last line; repair it so the next append is clean.
let fixtureText = existsSync(fixtureFile) ? readFileSync(fixtureFile, "utf8") : "";
const repair = planFixtureRepair(fixtureText);
if (repair.keepBytes !== null) {
  truncateSync(fixtureFile, repair.keepBytes); // drop the fragment; never rewrite the file
  fixtureText = fixtureText.slice(0, fixtureText.lastIndexOf("\n") + 1);
  console.log("Dropped an incomplete last line from the fixture file.");
} else if (repair.addNewline) {
  appendFileSync(fixtureFile, "\n");
  fixtureText += "\n";
  console.log("Added the missing newline after the last fixture line.");
}
const existing = parseFixtureLines(fixtureText);
const selectNow = (): string[] =>
  selectFirmsToExtract([...prepared.keys()], existing, { model, sample, hashes });
let selected = selectNow();
console.log(
  `${selected.length} of ${prepared.size} firms to extract with ${model} (${sync ? "sync" : "batch"}); cap $${maxUsd.toFixed(2)}.`,
);
console.log(
  systemPromptCaches(model, SYSTEM_PROMPT.length)
    ? "System prompt is long enough to cache; estimates assume cache reads."
    : "System prompt is below the model's minimum cacheable length; estimates assume no cache reads.",
);

// Worst case: every reply runs to max_tokens, so the cap is checked against a ceiling.
const estimate = (id: string): number =>
  estimateFirmCostUsd(
    model,
    prepared.get(id)!.user.length,
    SYSTEM_PROMPT.length,
    !sync,
    MAX_TOKENS,
  );

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

/** Never print more than the error's name, status, and message: no headers, no key. */
const describe = (err: unknown): string =>
  err instanceof Anthropic.APIError
    ? `${err.name} (${err.status ?? "no status"}): ${err.message}`
    : err instanceof Error
      ? `${err.name}: ${err.message}`
      : "unexpected error";

/** Connection trouble, timeouts, rate limits, and server errors: worth another try. */
const isTransient = (err: unknown): boolean =>
  err instanceof Anthropic.APIConnectionError ||
  (err instanceof Anthropic.APIError &&
    err.status !== undefined &&
    (err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500));

/** A bad key or permission stops the run; retrying every firm would only repeat it. */
const isFatal = (err: unknown): boolean =>
  !(err instanceof Anthropic.APIError) ||
  err instanceof Anthropic.AuthenticationError ||
  err instanceof Anthropic.PermissionDeniedError;

let extracted = 0;
let parsed = 0;
let failed = 0;
let groundedItems = 0;
let totalItems = 0;
let spent = 0;

/** Append one firm's record (a line per firm, so a stop loses at most the line in flight). Returns its cost. */
function record(id: string, reply: Reply): number {
  const { firm, docs, hash } = prepared.get(id)!;
  const output = parseExtraction(reply.text);
  const costUsd = costFromUsage(model, reply.usage, reply.batchId !== null);
  const line: FixtureRecord = {
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
  appendFileSync(fixtureFile, `${JSON.stringify(line)}\n`);
  existing.push(line);
  spent += costUsd; // counted as soon as the line is written, so an abort still reports it
  extracted++;
  if (output) {
    parsed++;
    const result = groundExtraction(firm, docs, output, model);
    groundedItems += result.observations.length;
    totalItems += result.observations.length + result.rejected.length;
  }
  return costUsd;
}

// The batch paid for but not yet written out, named in the stop message.
let pendingBatch: string | null = null;

/** Submit one Message Batch for the chunk. maxRetries 0: a retry after a lost response could create a second, paid batch. */
async function submitBatch(chunk: string[]): Promise<string> {
  const customIds = assignCustomIds(chunk);
  const byFirm = new Map([...customIds].map(([customId, firmId]) => [firmId, customId]));
  try {
    const batch = await client.messages.batches.create(
      { requests: chunk.map((id) => ({ custom_id: byFirm.get(id)!, params: request(id) })) },
      { maxRetries: 0 },
    );
    pendingBatch = batch.id;
    console.log(`  batch ${batch.id} submitted (${chunk.length} firms).`);
    return batch.id;
  } catch (err) {
    throw new Error(
      `${describe(err)}. The batch may have been created anyway: check the Anthropic console for a stray batch before rerunning.`,
    );
  }
}

/** Wait for the batch to end, then read every result. Poll and read errors are retried. */
async function collectBatch(
  batchId: string,
  customIds: Map<string, string>,
): Promise<Map<string, Reply>> {
  const retry = <T>(fn: () => Promise<T>): Promise<T> => withRetry(fn, { isTransient });
  console.log(`  waiting for ${batchId}; polling every ${POLL_MS / 1000}s.`);
  for (;;) {
    const status = (await retry(() => client.messages.batches.retrieve(batchId))).processing_status;
    if (status === "ended") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return retry(async () => {
    const replies = new Map<string, Reply>();
    let notSucceeded = 0;
    for await (const entry of await client.messages.batches.results(batchId)) {
      const firmId = customIds.get(entry.custom_id);
      if (firmId === undefined) {
        continue;
      }
      if (entry.result.type !== "succeeded") {
        notSucceeded++;
        continue;
      }
      const message = entry.result.message;
      // The API may return a dated id for an alias, so match on the prefix.
      if (!message.model.startsWith(model)) {
        throw new Error(
          `Batch ${batchId} was made with ${message.model}, not ${model}. Rerun with the --model it was made with; nothing was written.`,
        );
      }
      replies.set(firmId, {
        text: textOf(message),
        usage: usageOf(message.usage),
        latencyMs: null,
        batchId,
      });
    }
    if (notSucceeded > 0) {
      console.log(
        `  ${notSucceeded} requests errored, expired, or were canceled; a rerun retries them.`,
      );
    }
    return replies;
  });
}

/** Write a collected batch's replies for the firms in `wanted` that have no current record. Returns the cost written. */
function recordReplies(replies: Map<string, Reply>, wanted: readonly string[]): number {
  let cost = 0;
  for (const id of wanted) {
    const reply = replies.get(id);
    if (reply) {
      cost += record(id, reply);
    }
  }
  return cost;
}

/** The chunk one call at a time, timing each and writing each line as it arrives. */
async function runSync(chunk: string[]): Promise<number> {
  let cost = 0;
  for (const id of chunk) {
    const started = performance.now();
    try {
      const message = await client.messages.create(request(id));
      cost += record(id, {
        text: textOf(message),
        usage: usageOf(message.usage),
        latencyMs: Math.round(performance.now() - started),
        batchId: null,
      });
    } catch (err) {
      if (isFatal(err)) {
        throw err;
      }
      failed++;
      console.log(`  ${id}: ${describe(err)}; a rerun retries it.`);
    }
  }
  return cost;
}

let stopped = false;
let remaining: string[] = [];
let chunksDone = 0;
// Actual cost over estimated cost for the firms that replied; planning never assumes it is below 1.
let calibration = 1;

try {
  if (resumeBatch !== undefined) {
    console.log(`Resuming batch ${resumeBatch}.`);
    pendingBatch = resumeBatch;
    // Custom ids are firm ids (all fit the API's rules), so this maps them back for every firm.
    const replies = await collectBatch(resumeBatch, assignCustomIds([...prepared.keys()]));
    const missing = selectFirmsToExtract([...prepared.keys()], existing, { model, hashes });
    const cost = recordReplies(replies, missing);
    pendingBatch = null;
    console.log(`  wrote ${extracted} lines from the batch; cost $${cost.toFixed(4)}.`);
    selected = selectNow();
  }
  remaining = selected;
  while (remaining.length > 0) {
    const { chunks } = planChunks(
      remaining,
      (id) => estimate(id) * calibration,
      maxUsd,
      spent,
      chunkSize,
      chunksDone === 0 ? Math.min(chunkSize, FIRST_CHUNK_MAX) : chunkSize,
    );
    const chunk = chunks[0];
    if (!chunk) {
      break;
    }
    console.log(
      `Chunk of ${chunk.length} firms (spent $${spent.toFixed(4)} of $${maxUsd.toFixed(2)}).`,
    );
    const before = extracted;
    let chunkCost: number;
    if (sync) {
      chunkCost = await runSync(chunk);
    } else {
      const batchId = await submitBatch(chunk);
      const replies = await collectBatch(batchId, assignCustomIds(chunk));
      chunkCost = recordReplies(replies, chunk);
      pendingBatch = null;
    }
    const replied = extracted - before;
    const estimated = chunk.reduce((sum, id) => sum + estimate(id), 0);
    if (replied > 0) {
      calibration = Math.max(1, chunkCost / ((estimated * replied) / chunk.length));
    }
    chunksDone++;
    remaining = remaining.slice(chunk.length);
    console.log(
      `  wrote ${replied} lines; chunk cost $${chunkCost.toFixed(4)} (worst-case estimate $${estimated.toFixed(4)}).`,
    );
  }
} catch (err) {
  console.error(`Stopped: ${describe(err)}. Lines already written are kept.`);
  if (pendingBatch !== null) {
    console.error(
      `Batch ${pendingBatch} was paid for but not fully written. Rerun with --resume-batch ${pendingBatch} --model ${model} to collect it.`,
    );
  }
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
    ...(failed > 0 ? [`Requests that failed: ${failed}`] : []),
  ].join("\n"),
);
if (extracted > 0 && parsed / extracted < 0.9) {
  console.error(
    `WARNING: only ${parsed} of ${extracted} replies parsed as JSON (under 90%). Unparseable replies are stored as done (output: null). Check the prompt and max_tokens before committing these fixtures; delete the output: null lines to retry them.`,
  );
}
