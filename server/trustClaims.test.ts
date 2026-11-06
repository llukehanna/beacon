/**
 * The About and Trust pages and docs/security.md state figures that live in server code, Cloudflare
 * config and docs. This pins each one to its source so the claims cannot drift quietly.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIONS_PER_MINUTE,
  ACTIVITY_ROW_CEILING,
  CLAUDE_COOLDOWN_MINUTES,
  CLAUDE_DAILY_MAX,
  CSP_DIRECTIVES,
  FIRM_COUNT,
  MANDATE_CEILING,
  MAX_BODY_BYTES,
  MIN_FIRMS_PER_RULE,
  NIGHTLY_RESET_UTC,
  OTHER_HEADERS,
  RECORDED_RUN,
  RESETS_PER_MINUTE,
  RESET_COOLDOWN_MINUTES,
  SEARCH_CEILING,
} from "../src/about/facts";
import { MAX_ACTIVITY_ROWS } from "./actions/apply";
import { MAX_LIST, MAX_LIST_ITEM, MAX_STRING } from "./actions/params";
import { MIN_CLUSTER } from "./actions/rules";
import { MAX_MANDATES, MAX_SEARCHES } from "./actions/search";
import { CLAUDE_COOLDOWN_MS, CLAUDE_DAILY_MAX as SERVER_DAILY_MAX } from "./clustering/choose";
import { SECURITY_HEADERS, MAX_BODY_BYTES as SERVER_BODY_BYTES } from "./http";
import { UNIVERSE_SIZE } from "./seed/universe";

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
  });

  it("match the Cloudflare config", () => {
    expect(limiter("ACTIONS_LIMITER")).toEqual({ limit: ACTIONS_PER_MINUTE, period: 60 });
    expect(limiter("RESET_LIMITER")).toEqual({ limit: RESETS_PER_MINUTE, period: 60 });
    expect(read("wrangler.jsonc")).toContain('"crons": ["0 4 * * *"]');
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

describe("docs/security.md", () => {
  const doc = read("docs/security.md");

  it("quotes the same figures as the page", () => {
    expect(doc).toContain(CSP_DIRECTIVES.join("\n"));
    expect(doc).toContain(`${FIRM_COUNT} firms`);
    expect(doc).toContain(`${ACTIONS_PER_MINUTE} requests per minute`);
    expect(doc).toContain(`${RESETS_PER_MINUTE} per minute`);
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
