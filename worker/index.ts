/**
 * Cloudflare Workers entry. Static assets (the Vite build) are served by the
 * platform with an SPA fallback; /api/* runs here through the same handlers
 * that were Vercel Functions; the nightly Cron Trigger runs the reset.
 */
import * as actions from "../api/actions.js";
import * as links from "../api/links.js";
import * as objects from "../api/objects.js";
import * as reset from "../api/reset.js";
import { type Db, createPgDb, withRequestDb } from "../server/db/client.js";
import { ddl } from "../server/db/ddl.js";
import { HttpError } from "../server/errors.js";
import { jsonError } from "../server/http.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type Handler = (request: Request) => Promise<Response>;

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  actions,
  links,
  objects,
  reset,
};

let schemaApplied = false;

/** One Postgres pool per request; the idempotent DDL runs once per isolate. */
async function openDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new HttpError("The database is not configured", 503);
  }
  const db = createPgDb(url);
  if (!schemaApplied) {
    await db.exec(ddl());
    schemaApplied = true;
  }
  return db;
}

/** Runs `fn` with getDb() scoped to a fresh pool, closed once the response is done. */
async function withDb(ctx: ExecutionContext, fn: () => Promise<Response>): Promise<Response> {
  const db = openDb();
  db.catch(() => {}); // A missing DATABASE_URL surfaces through fn's own error handling.
  try {
    return await withRequestDb(db, fn);
  } finally {
    ctx.waitUntil(db.then((d) => d.close()).catch(() => {}));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const m = /^\/api\/([a-z]+)$/.exec(url.pathname);
    if (!m) {
      return env.ASSETS.fetch(request);
    }
    const handler = ROUTES[m[1]]?.[request.method];
    if (!handler) {
      return ROUTES[m[1]]
        ? new Response(null, { status: 405 })
        : jsonError(new HttpError("Not found", 404));
    }
    return withDb(ctx, () => handler(request));
  },

  /** Replaces the Vercel cron on /api/reset; same throttle as the demo bar's button. */
  async scheduled(_controller: unknown, _env: Env, ctx: ExecutionContext): Promise<void> {
    const res = await withDb(ctx, () => reset.POST());
    if (!res.ok) {
      throw new Error(`Nightly reset failed: ${res.status} ${await res.text()}`);
    }
  },
};
