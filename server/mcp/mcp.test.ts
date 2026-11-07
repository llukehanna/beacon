/**
 * The read-only MCP server: the JSON-RPC protocol, the tool list, the cap on results, the Desk
 * parity of a firm's evidence, and a full round trip through the HTTP handler against the seeded
 * demo. The information barrier through every tool is tested next to the rest of it, in
 * server/barrier.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as mcp } from "../../api/mcp.js";
import { type Db, overrideDb } from "../db/client.js";
import { listAll } from "../db/repo.js";
import { MAX_BODY_BYTES } from "../http.js";
import { resetDemo } from "../seed/reset.js";
import { createTestDb } from "../testing.js";
import {
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./rpc.js";
import { DEFAULT_RESULTS, MAX_RESULTS, clampLimit, listTools, scan } from "./tools.js";

let db: Db;
let showcaseId: string;

beforeAll(async () => {
  db = await createTestDb();
  overrideDb(db);
  await resetDemo(db, new Date("2026-09-22T12:00:00.000Z"));
  // A showcase firm: an open agent run with a conflict, a proposal and an abstention.
  const [row] = await db.query<{ firmId: string }>(
    `SELECT f."firmId"
       FROM firm f
      WHERE f."enrichedBy" = 'agent'
        AND EXISTS (SELECT 1 FROM research_finding r WHERE r."firmId" = f."firmId"
                      AND r."findingStatus" = 'proposed' AND r."conflictGroupId" IS NOT NULL)
        AND EXISTS (SELECT 1 FROM research_finding r WHERE r."firmId" = f."firmId"
                      AND r."findingStatus" = 'abstained')
      ORDER BY f."firmId" LIMIT 1`,
  );
  expect(row?.firmId).toBeDefined();
  showcaseId = row.firmId;
});

afterAll(async () => {
  await db.close();
});

/** A search hit or a listed rule: the fields these tests read. */
interface Row {
  firmId: string;
  firmName: string;
  score: number;
  tier: string;
  status: string;
  predicate: string;
}

type Axis = {
  axis: string;
  label: string;
  status: string;
  sides: Array<Record<string, unknown>>;
};

/** What a tool returns as structured content, as one shape: each tool fills in its own fields. */
interface Structured {
  firms: Row[];
  rules: Row[];
  axes: Axis[];
  firmId: string;
  limit: number;
  returned: number;
  totalMatches: number;
  partial: boolean;
}

interface ToolEntry {
  name: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  inputSchema: { type: string; additionalProperties: boolean };
}

/** A JSON-RPC reply. Each test reads the fields its method answers with, so all are declared. */
interface Rpc {
  id: number | string | null;
  error: { code: number; message: string };
  result: {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    tools: ToolEntry[];
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent: Structured;
  };
}

interface Reply {
  status: number;
  headers: Headers;
  json: Rpc;
}

const send = async (
  body: unknown,
  { persona, headers = {} }: { persona?: string; headers?: Record<string, string> } = {},
): Promise<Reply> => {
  const res = await mcp(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(persona ? { "x-beacon-persona": persona } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  // The reply is JSON of the shape under test; a notification has no body.
  return {
    status: res.status,
    headers: res.headers,
    json: (text === "" ? null : JSON.parse(text)) as Rpc,
  };
};

let nextId = 1;
const rpc = (method: string, params?: object, persona?: string) =>
  send({ jsonrpc: "2.0", id: nextId++, method, params }, { persona });
const tool = (name: string, args: object = {}, persona?: string) =>
  rpc("tools/call", { name, arguments: args }, persona);

describe("the JSON-RPC protocol", () => {
  it("negotiates the protocol version and offers tools only", async () => {
    const asked = SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
    const echoed = await rpc("initialize", { protocolVersion: asked, capabilities: {} });
    expect(echoed.status).toBe(200);
    expect(echoed.json.result).toMatchObject({
      protocolVersion: asked,
      capabilities: { tools: {} },
      serverInfo: { name: "beacon" },
    });
    expect(Object.keys(echoed.json.result.capabilities)).toEqual(["tools"]);
    // A version this server does not speak is answered with its newest.
    const newest = await rpc("initialize", { protocolVersion: "2099-01-01" });
    expect(newest.json.result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
    // The answer carries the request's id, and no session is opened.
    expect(echoed.json.id).toBe(nextId - 2);
    expect(echoed.headers.get("mcp-session-id")).toBeNull();
    const bad = await rpc("initialize", {});
    expect(bad.json.error.code).toBe(JSONRPC_INVALID_PARAMS);
  });

  it("answers a notification with a bare 202", async () => {
    const res = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(res.json).toBeNull();
  });

  it("answers ping, and an unknown method with -32601", async () => {
    expect((await rpc("ping")).json.result).toEqual({});
    const res = await rpc("resources/list");
    expect(res.status).toBe(200);
    expect(res.json.error).toMatchObject({ code: JSONRPC_METHOD_NOT_FOUND });
  });

  it("reports a body that is not JSON as -32700 and anything not a single message as -32600", async () => {
    const parse = await send("{not json");
    expect(parse.status).toBe(400);
    expect(parse.json).toMatchObject({ id: null, error: { code: JSONRPC_PARSE_ERROR } });
    for (const body of [
      [{ jsonrpc: "2.0", id: 1, method: "ping" }],
      "7",
      { id: 1, method: "ping" },
    ]) {
      const res = await send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe(JSONRPC_INVALID_REQUEST);
    }
    const noMethod = await send({ jsonrpc: "2.0", id: 3, method: 7 });
    expect(noMethod.json.error.code).toBe(JSONRPC_INVALID_REQUEST);
    const badParams = await send({ jsonrpc: "2.0", id: 4, method: "tools/list", params: [] });
    expect(badParams.json.error.code).toBe(JSONRPC_INVALID_PARAMS);
  });

  it("refuses a body over the size cap, declared or streamed, before reading it", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      pad: "x".repeat(MAX_BODY_BYTES),
    });
    // Streamed: no Content-Length, so the bytes are counted as they arrive.
    const streamed = await send(big);
    expect(streamed.status).toBe(413);
    // Declared: refused on the header alone.
    const declared = await send(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { "content-length": String(MAX_BODY_BYTES + 1) } },
    );
    expect(declared.status).toBe(413);
    // The cap is not on the message but on the body: a small one still works.
    expect((await rpc("ping")).status).toBe(200);
  });

  it("refuses another content type, another origin and an unknown protocol version", async () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const plain = await mcp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: msg,
      }),
    );
    expect(plain.status).toBe(415);
    const cross = await send(JSON.parse(msg), { headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    const version = await send(JSON.parse(msg), {
      headers: { "mcp-protocol-version": "1999-01-01" },
    });
    expect(version.status).toBe(400);
    const fine = await send(JSON.parse(msg), {
      headers: { "mcp-protocol-version": SUPPORTED_PROTOCOL_VERSIONS[0] },
    });
    expect(fine.status).toBe(200);
  });
});

describe("tools", () => {
  it("lists exactly three read-only tools, with their schemas", async () => {
    const res = await rpc("tools/list");
    expect(res.json.result.tools).toEqual(listTools());
    for (const t of res.json.result.tools) {
      expect(t.annotations.readOnlyHint, t.name).toBe(true);
      expect(t.annotations.destructiveHint, t.name).toBe(false);
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
    }
    // The schema snapshot: a change to a tool's name, arguments or wording shows up in review.
    expect(res.json.result.tools).toMatchSnapshot();
  });

  it("mcp rejects unknown tools and caps results", async () => {
    // An unknown tool is a protocol error naming the tool; so are unknown or mistyped arguments.
    const unknown = await tool("delete_firm", { firmId: "x" });
    expect(unknown.json.error).toEqual({
      code: JSONRPC_INVALID_PARAMS,
      message: "Unknown tool: delete_firm",
    });
    expect((await tool("constructor")).json.error.message).toBe("Unknown tool: constructor");
    expect((await rpc("tools/call", {})).json.error.code).toBe(JSONRPC_INVALID_PARAMS);
    for (const [name, args] of [
      ["search_firms", { limit: "ten" }],
      ["search_firms", { limit: 0 }],
      ["search_firms", { limit: 2.5 }],
      ["search_firms", { sql: "1; DROP TABLE firm" }],
      ["search_firms", { tier: "S" }],
      ["get_firm_evidence", {}],
      ["get_firm_evidence", { firmId: 7 }],
      ["list_rules", { status: "dismissed" }],
    ] as const) {
      const res = await tool(name, args);
      expect(res.json.error?.code, `${name} ${JSON.stringify(args)}`).toBe(JSONRPC_INVALID_PARAMS);
      expect(res.json.error.message).toContain(`Invalid arguments for ${name}`);
    }

    // Results are capped: a larger limit is clamped to the maximum, not refused.
    expect(MAX_RESULTS).toBe(25);
    expect(clampLimit(undefined)).toBe(DEFAULT_RESULTS);
    expect(clampLimit(1_000_000)).toBe(MAX_RESULTS);
    const dflt = await tool("search_firms");
    expect(dflt.json.result.structuredContent.firms).toHaveLength(DEFAULT_RESULTS);
    const big = await tool("search_firms", { limit: 100_000 });
    const found = big.json.result.structuredContent;
    expect(found.limit).toBe(MAX_RESULTS);
    expect(found.firms).toHaveLength(MAX_RESULTS);
    expect(found.returned).toBe(MAX_RESULTS);
    // The universe is larger than the cap, and the reply says so.
    expect(found.totalMatches).toBeGreaterThan(MAX_RESULTS);
    const one = await tool("search_firms", { limit: 1 });
    expect(one.json.result.structuredContent.firms).toHaveLength(1);
    const rules = await tool("list_rules", { limit: 9_999 });
    expect(rules.json.result.structuredContent.rules.length).toBeLessThanOrEqual(MAX_RESULTS);
  });

  it("says when the search stopped early, and only then", async () => {
    const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM firm`))[0].n;
    const saved = { ...scan };
    try {
      // Three pages of 100 firms read of a longer list: partial, and the count is of those read.
      scan.pageSize = 100;
      scan.maxPages = 3;
      const cut = (await tool("search_firms", {}, "compliance")).json.result.structuredContent;
      expect(cut.partial).toBe(true);
      expect(cut.totalMatches).toBe(300);

      // The scan ends exactly at the last firm: nothing was left unread.
      scan.pageSize = total;
      scan.maxPages = 1;
      const whole = (await tool("search_firms", {}, "compliance")).json.result.structuredContent;
      expect(whole.partial).toBe(false);
      expect(whole.totalMatches).toBe(total);

      // One firm short of the whole list is partial.
      scan.pageSize = total - 1;
      const short = (await tool("search_firms", {}, "compliance")).json.result.structuredContent;
      expect(short.partial).toBe(true);
      expect(short.totalMatches).toBe(total - 1);
    } finally {
      Object.assign(scan, saved);
    }
    // At the real limits the demo is searched in full.
    expect((await tool("search_firms")).json.result.structuredContent.partial).toBe(false);
    // The tool tells the model what to do about it.
    const description = listTools().find((t) => t.name === "search_firms")!.description;
    expect(description).toContain("partial: true");
    expect(description).toContain("narrow the query");
  });

  it("searches by name and filters, best score first", async () => {
    const all = (await tool("search_firms", { limit: 25 })).json.result.structuredContent;
    const scores = all.firms.map((f) => f.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const first = all.firms[0];
    expect(first).toMatchObject({ maxScore: 18 });
    expect(first.tier).toMatch(/^[ABC]|Rejected$/);

    const word = first.firmName.split(" ")[0].toLowerCase();
    const byName = (await tool("search_firms", { query: word.toUpperCase(), limit: 25 })).json
      .result.structuredContent;
    expect(byName.firms.map((f) => f.firmId)).toContain(first.firmId);
    for (const f of byName.firms) {
      expect(f.firmName.toLowerCase()).toContain(word);
    }
    const tierA = (await tool("search_firms", { tier: first.tier, limit: 25 })).json.result
      .structuredContent;
    expect(tierA.firms.every((f) => f.tier === first.tier)).toBe(true);
    const none = (await tool("search_firms", { query: "zzz-no-such-firm" })).json.result
      .structuredContent;
    expect(none).toMatchObject({ firms: [], totalMatches: 0, returned: 0 });
  });

  it("lists rules with the predicate in words", async () => {
    const res = (await tool("list_rules")).json.result.structuredContent;
    expect(res.rules.length).toBeGreaterThan(0);
    for (const r of res.rules) {
      expect(["pending", "approved"]).toContain(r.status);
      expect(r.predicate).toMatch(/^\S+ \S+ /);
    }
    const approved = (await tool("list_rules", { status: "approved" })).json.result
      .structuredContent;
    expect(approved.rules.every((r) => r.status === "approved")).toBe(true);
    const stored = await listAll(db, "ProposedRule");
    const pending = stored.filter((r) => (r.ruleStatus ?? "pending") === "pending").length;
    const got = (await tool("list_rules", { status: "pending", limit: 25 })).json.result
      .structuredContent;
    expect(got.totalMatches).toBe(pending);
  });

  it("reads and never writes (the access log aside)", async () => {
    const fingerprint = async () => {
      const tables = await db.query<{ t: string }>(
        `SELECT table_name AS t FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name <> 'access_log_entry' ORDER BY 1`,
      );
      const out: Record<string, string> = {};
      for (const { t } of tables) {
        const [row] = await db.query<{ h: string }>(
          `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`,
        );
        out[t] = row.h;
      }
      return out;
    };
    const before = await fingerprint();
    await tool("search_firms", { limit: 25 });
    await tool("get_firm_evidence", { firmId: showcaseId });
    await tool("list_rules");
    expect(await fingerprint()).toEqual(before);
  });
});

describe("get_firm_evidence", () => {
  it("returns the citations the Desk shows for the showcase firm", async () => {
    // The Desk's own model for a firm (the tear sheet is built from the same axis rows the grid
    // renders), loaded the way the browser loads it. It is imported by a computed path because the
    // server's type check does not resolve the app's "@/" alias.
    const modelPath = "../../src/tearsheet/tearSheetModel";
    const { buildTearSheet } = (await import(/* @vite-ignore */ modelPath)) as {
      buildTearSheet: (input: {
        firm: unknown;
        findings: unknown[];
        decisions: unknown[];
        rules: unknown[];
      }) => {
        evidence: Array<Record<string, unknown>>;
        conflicts: Array<{ axis: string; sides: Array<Record<string, unknown>> }>;
        abstentions: Array<{ axis: string }>;
      };
    };
    const [firm] = await listAll(db, "Firm", { where: { firmId: { $eq: showcaseId } } });
    const findings = await listAll(db, "ResearchFinding", {
      where: { firmId: { $eq: showcaseId } },
    });
    const sheet = buildTearSheet({ firm, findings, decisions: [], rules: [] });

    const res = await tool("get_firm_evidence", { firmId: showcaseId });
    expect(res.json.result.isError).toBeUndefined();
    const evidence = res.json.result.structuredContent;
    expect(evidence).toMatchObject({ firmId: showcaseId, firmName: firm.firmName });
    // The text content is the same JSON as the structured content.
    expect(JSON.parse(res.json.result.content[0].text)).toEqual(evidence);

    const axes = evidence.axes;
    const cite = (a: Record<string, unknown>) => ({
      value: a.value,
      provider: a.provider,
      quote: a.quote,
      model: a.model,
    });
    const settled = axes
      .filter((a) => ["verified", "proposed", "signal"].includes(a.status))
      .map((a) => ({ axis: a.label, status: a.status, ...cite(a) }));
    expect(settled).toEqual(
      sheet.evidence.map((e) => ({ axis: e.axis, status: e.status, ...cite(e) })),
    );
    const conflicts = axes
      .filter((a) => a.status === "conflict")
      .map((a) => ({ axis: a.label, sides: a.sides.map(cite) }));
    expect(conflicts).toEqual(
      sheet.conflicts.map((c) => ({ axis: c.axis, sides: c.sides.map(cite) })),
    );
    expect(axes.filter((a) => a.status === "abstained").map((a) => ({ axis: a.label }))).toEqual(
      sheet.abstentions.map((a) => ({ axis: a.axis })),
    );

    // The comparison is not vacuous: the showcase firm has a quoted value, a conflict and an abstention.
    expect(settled.some((a) => a.quote !== null && a.model !== null)).toBe(true);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(sheet.abstentions.length).toBeGreaterThan(0);
    // An axis with no value carries no citation.
    for (const a of axes.filter((x) => x.status === "abstained" || x.status === "empty")) {
      expect(cite(a)).toEqual({ value: null, provider: null, quote: null, model: null });
    }
  });

  it("is a not-found result, not a protocol error, for an unknown firm", async () => {
    const res = await tool("get_firm_evidence", { firmId: "no-such-firm" });
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    expect(res.json.result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Firm no-such-firm not found" }],
    });
  });
});

describe("a round trip through the handler", () => {
  it("initialize, initialized, tools/list and tools/call, as a client would", async () => {
    const init = await send({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[1],
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    });
    expect(init.json).toMatchObject({ jsonrpc: "2.0", id: "init-1" });
    expect(init.headers.get("content-type")).toContain("application/json");
    expect((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.json.result.tools.map((t) => t.name);
    expect(names).toEqual(["search_firms", "get_firm_evidence", "list_rules"]);

    const found = await send(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_firms", arguments: { limit: 3 } },
      },
      { persona: "analyst" },
    );
    expect(found.json.id).toBe(3);
    const hit = found.json.result.structuredContent.firms[0];
    const opened = await send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_firm_evidence", arguments: { firmId: hit.firmId } },
    });
    expect(opened.json.result.structuredContent.firmId).toBe(hit.firmId);
    // Vary on the persona header, as every other route.
    expect(opened.headers.get("vary")).toContain("X-Beacon-Persona");
    expect(opened.headers.get("cache-control")).toBe("no-store");
  });
});
