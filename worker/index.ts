/**
 * Cloudflare Workers entry. Static assets (the Vite build) are served by the
 * platform with an SPA fallback; /api/* runs here through the handlers in
 * api/; the nightly Cron Trigger runs the demo reset.
 */
import * as actions from "../api/actions.js";
import * as functions from "../api/functions.js";
import * as links from "../api/links.js";
import * as objects from "../api/objects.js";
import * as reset from "../api/reset.js";
import { type Db, createPgDb, withRequestDb } from "../server/db/client.js";
import { ddl } from "../server/db/ddl.js";
import { HttpError } from "../server/errors.js";
import { jsonError } from "../server/http.js";
import { type RateLimit, checkRate } from "./rateLimit.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Rate limit bindings (wrangler.jsonc "ratelimits"); absent in local dev and tests. */
  ACTIONS_LIMITER?: RateLimit;
  RESET_LIMITER?: RateLimit;
  /** Optional Hyperdrive binding; when present it replaces the direct DATABASE_URL. */
  HYPERDRIVE?: { connectionString: string };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type Handler = (request: Request) => Promise<Response>;

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  actions,
  functions,
  links,
  objects,
  reset,
};

let schemaApplied = false;

/** Hyperdrive when bound, otherwise the DATABASE_URL secret. */
export function connectionStringFor(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;
}

/** One Postgres pool per request; the idempotent DDL runs once per isolate. */
async function openDb(env: Env): Promise<Db> {
  const url = connectionStringFor(env);
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
async function withDb(
  env: Env,
  ctx: ExecutionContext,
  fn: () => Promise<Response>,
): Promise<Response> {
  const db = openDb(env);
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
    if (request.method === "POST") {
      const limiter =
        m[1] === "actions" ? env.ACTIONS_LIMITER : m[1] === "reset" ? env.RESET_LIMITER : undefined;
      const refused = await checkRate(limiter, request);
      if (refused) {
        return refused;
      }
    }
    return withDb(env, ctx, () => handler(request));
  },

  /** Nightly Cron Trigger: runs the same reset (and throttle) as the demo bar's button. */
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    const res = await withDb(env, ctx, () => reset.POST());
    if (!res.ok) {
      throw new Error(`Nightly reset failed: ${res.status} ${await res.text()}`);
    }
  },
};
