import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, withRequestDb } from "../server/db/client.js";
import { createTestDb } from "../server/testing.js";
import worker from "./index.js";

const assets = { fetch: vi.fn(async () => new Response("<!doctype html>", { status: 200 })) };
const env = { ASSETS: assets };
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
const get = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://beacon.example${path}`, init), env, ctx);

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

  it("reports a missing DATABASE_URL as 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const res = await get("/api/objects?type=Firm");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The database is not configured" });
  });
});

describe("withRequestDb", () => {
  it("scopes getDb() to the request's database", async () => {
    const db = await createTestDb();
    const seen = await withRequestDb(Promise.resolve(db), () => getDb());
    expect(seen).toBe(db);
  });
});
