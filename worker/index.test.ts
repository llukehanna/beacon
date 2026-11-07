import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, withRequestDb } from "../server/db/client.js";
import { createTestDb } from "../server/testing.js";
import * as entry from "./index.js";
import worker, { connectionStringFor } from "./index.js";

const assets = { fetch: vi.fn(async () => new Response("<!doctype html>", { status: 200 })) };
const env: Parameters<typeof worker.fetch>[1] = { ASSETS: assets };
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
const get = (path: string, init?: RequestInit, withEnv = env) =>
  worker.fetch(new Request(`https://beacon.example${path}`, init), withEnv, ctx);
const limiter = (success: boolean) => ({ limit: vi.fn(async () => ({ success })) });

afterEach(async () => {
  await Promise.all(waits.splice(0));
  vi.unstubAllEnvs();
  assets.fetch.mockClear();
});

describe("worker fetch", () => {
  it("hands everything outside /api to the static assets", async () => {
    expect((await get("/desk/deep/link")).status).toBe(200);
    expect(assets.fetch).toHaveBeenCalledOnce();
  });

  it("answers unknown endpoints and methods without touching the database", async () => {
    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/api/objects", { method: "DELETE" })).status).toBe(405);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("does not reset the demo over GET (only the button's POST and the cron do)", async () => {
    expect((await get("/api/reset")).status).toBe(405);
  });

  it("reports a missing DATABASE_URL as 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const res = await get("/api/objects?type=Firm");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The database is not configured" });
  });
});

describe("rate limiting", () => {
  const post = (path: string) => ({
    path,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: "{}",
    },
  });

  it("answers 429 JSON on POST /api/actions when the limiter refuses", async () => {
    const ACTIONS_LIMITER = limiter(false);
    const { path, init } = post("/api/actions");
    const res = await get(path, init, { ...env, ACTIONS_LIMITER });
    expect(res.status).toBe(429);
    expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ACTIONS_LIMITER.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("limits POST /api/reset with its own limiter", async () => {
    const ACTIONS_LIMITER = limiter(true);
    const RESET_LIMITER = limiter(false);
    const { path, init } = post("/api/reset");
    const res = await get(path, init, { ...env, ACTIONS_LIMITER, RESET_LIMITER });
    expect(res.status).toBe(429);
    expect(ACTIONS_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("limits POST /api/mcp with its own limiter, and offers no GET", async () => {
    const ACTIONS_LIMITER = limiter(true);
    const MCP_LIMITER = limiter(false);
    const { path, init } = post("/api/mcp");
    const res = await get(path, init, { ...env, ACTIONS_LIMITER, MCP_LIMITER });
    expect(res.status).toBe(429);
    expect(MCP_LIMITER.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(ACTIONS_LIMITER.limit).not.toHaveBeenCalled();
    // No event stream is offered, so the Worker answers a GET 405 before it touches a database.
    expect((await get("/api/mcp")).status).toBe(405);
    expect((await get("/api/mcp", { method: "DELETE" })).status).toBe(405);
  });

  it("does not limit reads", async () => {
    const ACTIONS_LIMITER = limiter(false);
    vi.stubEnv("DATABASE_URL", "");
    const res = await get("/api/objects?type=Firm", undefined, { ...env, ACTIONS_LIMITER });
    expect(res.status).toBe(503);
    expect(ACTIONS_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("reaches the handler when no limiter is bound", async () => {
    const { path, init } = post("/api/actions");
    // The handler itself rejects the empty action body (400); 429 would mean the limiter ran.
    expect((await get(path, init)).status).toBe(400);
  });

  it("falls back to a shared key when the client IP is unknown", async () => {
    const ACTIONS_LIMITER = limiter(true);
    vi.stubEnv("DATABASE_URL", "");
    await get("/api/actions", { method: "POST", body: "{}" }, { ...env, ACTIONS_LIMITER });
    expect(ACTIONS_LIMITER.limit).toHaveBeenCalledWith({ key: "unknown" });
  });
});

describe("connectionStringFor", () => {
  it("prefers the Hyperdrive binding over DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "postgres://direct");
    expect(connectionStringFor({ ...env, HYPERDRIVE: { connectionString: "postgres://hd" } })).toBe(
      "postgres://hd",
    );
  });

  it("falls back to DATABASE_URL without the binding", () => {
    vi.stubEnv("DATABASE_URL", "postgres://direct");
    expect(connectionStringFor(env)).toBe("postgres://direct");
  });
});

describe("withRequestDb", () => {
  it("scopes getDb() to the request's database", async () => {
    const db = await createTestDb();
    const seen = await withRequestDb(Promise.resolve(db), () => getDb());
    expect(seen).toBe(db);
  });
});

describe("functions route", () => {
  it("serves GET /api/functions through the database wrapper, unthrottled, and nothing else", async () => {
    const ACTIONS_LIMITER = limiter(false);
    vi.stubEnv("DATABASE_URL", "");
    // 503 comes from withDb (no database configured): the route exists, reads, and is not rate-limited.
    const res = await get("/api/functions?name=homeSummary", undefined, {
      ...env,
      ACTIONS_LIMITER,
    });
    expect(res.status).toBe(503);
    expect(ACTIONS_LIMITER.limit).not.toHaveBeenCalled();
    expect((await get("/api/functions?name=homeSummary", { method: "POST" })).status).toBe(405);
  });
});

describe("worker entry module", () => {
  // workerd treats every named export of the entry module as an entrypoint and refuses to boot when
  // one is a string or number, so constants live elsewhere (worker/crons.ts).
  it("exports only functions or handler objects, and a default with fetch and scheduled", () => {
    for (const [name, value] of Object.entries(entry)) {
      if (name === "default") {
        continue;
      }
      const ok = typeof value === "function" || (typeof value === "object" && value !== null);
      expect(ok, `named export ${name} is a ${typeof value}`).toBe(true);
    }
    expect(typeof entry.default.fetch).toBe("function");
    expect(typeof entry.default.scheduled).toBe("function");
  });
});
