/**
 * The About and Trust pages and docs/security.md state figures that live in server code, Cloudflare
 * config and docs. This pins each one to its source so the claims cannot drift quietly.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "../shared/schema";
import {
  ACCESS_LOG_CEILING,
  ACCESS_LOG_DEBOUNCE_SECONDS,
  ACTIONS_PER_MINUTE,
  ACTIVITY_ROW_CEILING,
  CLAUDE_COOLDOWN_MINUTES,
  CLAUDE_DAILY_MAX,
  CSP_DIRECTIVES,
  FIRM_COUNT,
  MANDATE_CEILING,
  MAX_BODY_BYTES,
  MCP_PER_MINUTE,
  MCP_RESULT_CAP,
  MIN_FIRMS_PER_RULE,
  NIGHTLY_RESET_UTC,
  OBJECT_TYPE_COUNT,
  OTHER_HEADERS,
  RECORDED_RUN,
  RESETS_PER_MINUTE,
  RESET_COOLDOWN_MINUTES,
  RESTRICTED_FIRM_COUNT,
  SEARCH_CEILING,
} from "../src/about/facts";
import { MAX_ACCESS_LOG, VIEW_DEBOUNCE_SECONDS } from "./access";
import { MAX_ACTIVITY_ROWS } from "./actions/apply";
import { MAX_LIST, MAX_LIST_ITEM, MAX_STRING } from "./actions/params";
import { MIN_CLUSTER } from "./actions/rules";
import { MAX_MANDATES, MAX_SEARCHES } from "./actions/search";
import { CLAUDE_COOLDOWN_MS, CLAUDE_DAILY_MAX as SERVER_DAILY_MAX } from "./clustering/choose";
import { SECURITY_HEADERS, MAX_BODY_BYTES as SERVER_BODY_BYTES } from "./http";
import { MAX_RESULTS } from "./mcp/tools";
import { MAX_ACTION_RUNS } from "./operations/record";
import { RESTRICTED_FIRM_COUNT as SEEDED_RESTRICTED } from "./seed/barriers";
import { LOOKAHEAD_MS, LOOKBACK_MS, SIGNAL_TARGET } from "./seed/signals";
import { UNIVERSE_SIZE } from "./seed/universe";
import { MAX_SIGNALS_PER_RUN } from "./signals/run";

const ROOT = resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

/** The `limit` and `period` of a named limiter in wrangler.jsonc (the top-level block). */
function limiter(name: string): { limit: number; period: number } {
  const m = new RegExp(
    `"name":\\s*"${name}"[^}]*"simple":\\s*\\{\\s*"limit":\\s*(\\d+),\\s*"period":\\s*(\\d+)`,
  ).exec(read("wrangler.jsonc"));
  if (m === null) {
    throw new Error(`no ${name} in wrangler.jsonc`);
  }
  return { limit: Number(m[1]), period: Number(m[2]) };
}

describe("figures on the About and Trust pages", () => {
  it("match the server constants", () => {
    expect(FIRM_COUNT).toBe(UNIVERSE_SIZE);
    expect(CLAUDE_COOLDOWN_MINUTES * 60_000).toBe(CLAUDE_COOLDOWN_MS);
    expect(CLAUDE_DAILY_MAX).toBe(SERVER_DAILY_MAX);
    expect(ACTIVITY_ROW_CEILING).toBe(MAX_ACTIVITY_ROWS);
    expect(MANDATE_CEILING).toBe(MAX_MANDATES);
    expect(SEARCH_CEILING).toBe(MAX_SEARCHES);
    expect(MAX_BODY_BYTES).toBe(SERVER_BODY_BYTES);
    expect(MIN_FIRMS_PER_RULE).toBe(MIN_CLUSTER);
    expect(RESTRICTED_FIRM_COUNT).toBe(SEEDED_RESTRICTED);
    expect(ACCESS_LOG_CEILING).toBe(MAX_ACCESS_LOG);
    expect(ACCESS_LOG_DEBOUNCE_SECONDS).toBe(VIEW_DEBOUNCE_SECONDS);
  });

  it("match the Cloudflare config", () => {
    expect(limiter("ACTIONS_LIMITER")).toEqual({ limit: ACTIONS_PER_MINUTE, period: 60 });
    expect(limiter("RESET_LIMITER")).toEqual({ limit: RESETS_PER_MINUTE, period: 60 });
    expect(limiter("MCP_LIMITER")).toEqual({ limit: MCP_PER_MINUTE, period: 60 });
    // One hourly trigger: the 04:00 run resets, every run applies the market signals that are due.
    expect(read("wrangler.jsonc")).toContain('"crons": ["0 * * * *"]');
    expect(read("worker/crons.ts")).toContain(
      `NIGHTLY_HOUR_UTC = ${Number(NIGHTLY_RESET_UTC.slice(0, 2))}`,
    );
    expect(NIGHTLY_RESET_UTC).toBe("04:00");
    expect(read("api/reset.ts")).toContain(`COOLDOWN_MS = ${RESET_COOLDOWN_MINUTES} * 60_000`);
  });

  it("quote the Content-Security-Policy and headers in public/_headers", () => {
    const headers = read("public/_headers");
    expect(headers).toContain(`Content-Security-Policy: ${CSP_DIRECTIVES.join("; ")}\n`);
    for (const [name, value] of OTHER_HEADERS) {
      expect(headers).toContain(`${name}: ${value}`);
      expect(SECURITY_HEADERS[name]).toBe(value);
    }
  });

  it("match the recorded run's grounding figures recomputed by the evaluation", () => {
    const evals = JSON.parse(read("docs/evals.json")) as {
      recordedRun: { values: number; grounded: number };
    };
    expect(evals.recordedRun).toEqual({
      values: RECORDED_RUN.valuesExtracted,
      grounded: RECORDED_RUN.valuesGrounded,
    });
  });

  it("match the recorded run in docs/architecture.md", () => {
    const doc = read("docs/architecture.md");
    const n = (v: number): string => v.toLocaleString("en-US");
    expect(doc).toContain(`All ${RECORDED_RUN.firms} firms were extracted`);
    expect(doc).toContain(
      `Of ${n(RECORDED_RUN.valuesExtracted)} extracted values, ${n(RECORDED_RUN.valuesGrounded)} passed the grounding check`,
    );
    expect(doc).toContain(`The run cost ${RECORDED_RUN.extractionCost}`);
    expect(doc).toContain(`${RECORDED_RUN.clusteringCost}.`);
    expect(doc).toContain("Claude Haiku 4.5");
  });
});

describe("the object type count", () => {
  it("is the one the docs and the schema state", () => {
    expect(OBJECT_TYPE_COUNT).toBe(Object.keys(OBJECT_TYPES).length);
    expect(read("docs/architecture.md")).toContain(`the ${OBJECT_TYPE_COUNT} object types`);
    expect(read("docs/architecture.md")).toContain(`${OBJECT_TYPE_COUNT} object tables`);
    expect(read("README.md")).toContain(`${OBJECT_TYPE_COUNT} object tables`);
    expect(read("docs/foundry-origins.md")).toContain(`${OBJECT_TYPE_COUNT} object types`);
  });

  it("keeps operations metrics out of the snapshot and the stored-run ceiling in the docs", () => {
    expect(read("docs/security.md")).toContain(
      `up to ${MAX_ACTION_RUNS.toLocaleString("en-US")} action runs`,
    );
    expect(read("docs/architecture.md")).toContain(
      `capped at ${MAX_ACTION_RUNS.toLocaleString("en-US")} stored action runs`,
    );
  });
});

describe("docs/error-analysis.md", () => {
  const evals = JSON.parse(read("docs/evals.json")) as {
    slots: { total: number; correct: number };
    failures: { kind: string; count: number; examples: { firmId: string; axis: string }[] }[];
    reconciled: { higherTrustRight: number; precision: number; conflictRate: number };
    abstention: { rate: number; calibration: number };
    providers: { provider: string; precision: number }[];
    recordedRun: { values: number; grounded: number };
    ruleRecovery: { planted: number; recovered: number };
  };
  const doc = read("docs/error-analysis.md");
  const n = (v: number): string => v.toLocaleString("en-US");

  it("states the taxonomy counts from docs/evals.json", () => {
    expect(doc).toContain(`${n(evals.slots.total)} firm axes`);
    expect(doc).toContain(`${n(evals.slots.correct)} of them`);
    for (const f of evals.failures) {
      expect(doc).toContain(`(\`${f.kind}\`) | ${n(f.count)} |`);
    }
    expect(doc).toContain(`${(evals.reconciled.higherTrustRight * 100).toFixed(1)}%`);
  });

  it("states every other figure from docs/evals.json too", () => {
    const pct = (v: number): string => (v * 100).toFixed(1);
    const precisionOf = (provider: string): number =>
      evals.providers.find((p) => p.provider === provider)!.precision;
    const wrong = evals.failures.find((f) => f.kind === "wrong-source-wins")!.count;
    const conflicts = evals.failures.find((f) => f.kind === "conflict-surfaced")!.count;
    const abstained = evals.failures.find((f) => f.kind === "abstained-correctly")!.count;
    // Shares of the evaluated axes, and the correct share.
    expect(doc).toContain(`(${pct(evals.slots.correct / evals.slots.total)}%)`);
    for (const f of evals.failures) {
      expect(doc).toContain(`| ${n(f.count)} | ${pct(f.count / evals.slots.total)}% |`);
    }
    // The wrong values settled, as a share of settled values, and the precision it complements.
    expect(doc).toContain(
      `${n(wrong)} wrong values settled are ${pct(1 - evals.reconciled.precision)}%`,
    );
    expect(doc).toContain(`reconciled precision is ${pct(evals.reconciled.precision)}%`);
    // The trust-order tiebreak and the provider precisions it quotes.
    expect(doc).toContain(`wrong in the other ${pct(1 - evals.reconciled.higherTrustRight)}%`);
    expect(doc).toContain(
      `${pct(precisionOf("websearch"))}% precision against ${pct(precisionOf("beacondb"))}% for BeaconDB`,
    );
    // Conflicts, abstentions and rule recovery.
    expect(doc).toContain(
      `The ${n(conflicts)} conflicts (${pct(evals.reconciled.conflictRate)}% of axes`,
    );
    expect(doc).toContain(`Of the ${n(conflicts)} conflicts`);
    expect(doc).toContain(`${n(abstained)} axes (${pct(evals.abstention.rate)}%) ended this way`);
    expect(doc).toContain(
      `${pct(evals.abstention.calibration).replace(/\.0$/, "")}% of abstentions were justified`,
    );
    expect(doc).toContain(
      `${evals.ruleRecovery.recovered} of ${evals.ruleRecovery.planted} (\`ruleRecovery\`)`,
    );
  });

  it("counts the answers the grounding check dropped from the recorded run", () => {
    const dropped = evals.recordedRun.values - evals.recordedRun.grounded;
    expect(doc).toContain(`The ${dropped} answers the grounding check dropped`);
  });

  it("links every example to its firm on the Desk", () => {
    for (const f of evals.failures) {
      for (const e of f.examples) {
        expect(doc).toContain(
          `[\`${e.firmId}\`, ${e.axis}](https://beacon.lukeghanna.com/desk?firmId=${e.firmId})`,
        );
      }
    }
  });
});

describe("About page wording", () => {
  const about = ["AboutPage.tsx", "ArchitectureDiagram.tsx"]
    .map((f) => read(`src/about/${f}`))
    .join("\n");

  it("does not claim blanket append-only history", () => {
    // Findings, drift events and rules change status fields; only scores and decisions are insert-only.
    expect(about).not.toMatch(/append-only|only add rows/i);
    expect(about).toContain("scores and decisions");
  });
});

describe("the MCP result cap", () => {
  it("is the one the Trust page, the security notes and the MCP guide state", () => {
    expect(MCP_RESULT_CAP).toBe(MAX_RESULTS);
    expect(read("docs/security.md")).toContain(`A list returns at most ${MAX_RESULTS} rows`);
    const guide = read("docs/mcp.md");
    expect(guide).toContain(`**Results are capped at ${MAX_RESULTS}.**`);
    expect(guide).toContain(`A larger \`limit\` is clamped to ${MAX_RESULTS}`);
    expect(guide).toContain(`capped at ${MAX_RESULTS} `);
    expect(guide).toContain(`lists stop at ${MAX_RESULTS} rows`);
    // The Trust page prints the figure from facts.ts, so it must not carry its own literal.
    expect(read("src/about/TrustPage.tsx")).toContain("{MCP_RESULT_CAP} rows from any list");
  });
});

describe("the market signal figures in docs/architecture.md", () => {
  it("match the seed and the hourly run", () => {
    const doc = read("docs/architecture.md");
    const DAY = 24 * 60 * 60_000;
    const HOUR = 60 * 60_000;
    expect(doc).toContain(`about ${SIGNAL_TARGET} of them`);
    expect(doc).toContain(`from ${LOOKBACK_MS / DAY} days before the seed`);
    expect(doc).toContain(`to ${LOOKAHEAD_MS / HOUR} hours after it`);
    expect(doc).toContain(`at most ${MAX_SIGNALS_PER_RUN} per run`);
  });
});

describe("docs/security.md", () => {
  const doc = read("docs/security.md");

  it("quotes the same figures as the page", () => {
    expect(doc).toContain(CSP_DIRECTIVES.join("\n"));
    expect(doc).toContain(`${FIRM_COUNT} firms`);
    expect(doc).toContain(`${ACTIONS_PER_MINUTE} requests per minute`);
    expect(doc).toContain(`${RESETS_PER_MINUTE} per minute`);
    expect(doc).toContain(`${MCP_PER_MINUTE} requests per minute per client IP`);
    expect(doc).toContain(`${CLAUDE_COOLDOWN_MINUTES} minutes and ${CLAUDE_DAILY_MAX} per UTC day`);
    expect(doc).toContain(`${NIGHTLY_RESET_UTC} UTC`);
    expect(doc).toContain(`${RESET_COOLDOWN_MINUTES} minutes`);
    expect(doc).toContain(`${MAX_BODY_BYTES.toLocaleString("en-US")} bytes`);
    expect(doc).toContain(`strings up to ${MAX_STRING.toLocaleString("en-US")} characters`);
    expect(doc).toContain(`lists up to ${MAX_LIST} items of up to ${MAX_LIST_ITEM} characters`);
    expect(doc).toContain(`${MANDATE_CEILING} mandates, ${SEARCH_CEILING} searches`);
    expect(doc).toContain(`${ACTIVITY_ROW_CEILING.toLocaleString("en-US")} activity rows`);
    expect(doc).toContain(
      `at least ${["zero", "one", "two", "three", "four"][MIN_FIRMS_PER_RULE]} distinct firms`,
    );
    // The information barrier section.
    const restricted = ["Zero", "One", "Two", "Three", "Four"][RESTRICTED_FIRM_COUNT];
    expect(doc).toContain(`${restricted} firms are restricted`);
    expect(doc).toContain(`keeps the newest ${ACCESS_LOG_CEILING} rows`);
    expect(doc).toContain(`within ${ACCESS_LOG_DEBOUNCE_SECONDS} seconds`);
    expect(doc).toContain("## Information barriers (demo)");
    expect(doc).toContain("derive the persona from single sign-on, never from a header");
  });

  it("names a source file for every claim, and every named file exists", () => {
    const unsourced: string[] = [];
    let inFence = false;
    for (const line of doc.split("\n")) {
      if (line.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      const isClaim = !inFence && /^(- |[A-Z])/.test(line);
      const m = /<!-- source: (.+?) -->/.exec(line);
      if (isClaim && m === null) {
        unsourced.push(line.slice(0, 70));
      }
      if (m !== null) {
        for (const file of m[1].split(",").map((f) => f.trim())) {
          expect(existsSync(resolve(ROOT, file)), `${file} does not exist`).toBe(true);
        }
      }
    }
    // The two framing sentences at the top cite the doc and its test rather than a source file.
    expect(
      unsourced.filter((l) => !l.startsWith("This is what") && !l.startsWith("The [Trust")),
    ).toEqual([]);
  });
});
