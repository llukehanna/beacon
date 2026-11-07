import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../server/db/client.js";
import { migrate } from "../server/db/migrate.js";

// The Worker's database is a PGlite stand-in whose pool "close" keeps it open for the next request.
let current: Db;
const unmigrated = async (): Promise<Db> => {
  const { createPgliteDb } = await import("../server/db/client.js");
  return createPgliteDb();
};

vi.mock("../server/db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/db/client.js")>()),
  createPgDb: vi.fn(() => ({ ...current, close: async () => {} })),
}));

const { default: worker } = await import("./index.js");

const assets = { fetch: vi.fn(async () => new Response("<!doctype html>", { status: 200 })) };
const env = { ASSETS: assets, HYPERDRIVE: { connectionString: "postgres://test" } };
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
const get = (path: string) => worker.fetch(new Request(`https://beacon.example${path}`), env, ctx);

afterEach(async () => {
  await Promise.all(waits.splice(0));
});

describe("worker", () => {
  it("refuses requests when the schema version is behind, and serves again once it is migrated", async () => {
    current = await unmigrated();
    const refused = await get("/api/functions?name=shellCounts");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "The database schema is behind this build" });
    // Every /api route is refused, the nightly reset's included; static assets are not.
    expect((await get("/api/objects?type=Firm")).status).toBe(503);
    expect((await get("/")).status).toBe(200);
    expect(assets.fetch).toHaveBeenCalledOnce();
    // The Worker changed nothing: the database has no tables.
    expect(await current.query(`SELECT to_regclass('schema_migrations') AS t`)).toEqual([
      { t: null },
    ]);

    await migrate(current);
    const query = vi.spyOn(current, "query");
    const versionReads = () => query.mock.calls.filter(([sql]) => /schema_migrations/.test(sql));
    expect((await get("/api/functions?name=shellCounts")).status).toBe(200);
    const readsForFirst = versionReads().length;
    expect(
      readsForFirst,
      "the version is read when the isolate first sees it current",
    ).toBeGreaterThan(0);
    // The isolate has seen it current: later requests do not read it again.
    expect((await get("/api/functions?name=shellCounts")).status).toBe(200);
    expect(versionReads()).toHaveLength(readsForFirst);
  });
});
