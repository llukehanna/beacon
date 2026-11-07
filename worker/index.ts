/**
 * Cloudflare Workers entry. Static assets (the Vite build) are served by the
 * platform with an SPA fallback; /api/* runs here through the handlers in
 * api/; the hourly Cron Trigger applies the synthetic market signals that have come due, and its
 * 04:00 UTC run is the nightly demo reset (for the presenter deployment too, through a service binding).
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import * as actions from "../api/actions.js";
import * as functions from "../api/functions.js";
import * as links from "../api/links.js";
import * as mcp from "../api/mcp.js";
import * as objects from "../api/objects.js";
import * as reset from "../api/reset.js";
import { type Db, createPgDb, getDb, withRequestDb } from "../server/db/client.js";
import { LATEST_MIGRATION, schemaVersion } from "../server/db/migrate.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError } from "../server/http.js";
import { rpcCodeForStatus, rpcFailureBody } from "../server/mcp/rpc.js";
import { applyDueSignals } from "../server/signals/run.js";
import { HOURLY_CRON, NIGHTLY_CRON, NIGHTLY_HOUR_UTC } from "./crons.js";
import { type RateLimit, checkRate } from "./rateLimit.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Rate limit bindings (wrangler.jsonc "ratelimits"); absent in local dev and tests. */
  ACTIONS_LIMITER?: RateLimit;
  RESET_LIMITER?: RateLimit;
  MCP_LIMITER?: RateLimit;
  /** Optional Hyperdrive binding; when present it replaces the direct DATABASE_URL. */
  HYPERDRIVE?: { connectionString: string };
  /**
   * Production only (wrangler.jsonc "services"): the presenter deployment's PresenterNightly
   * entrypoint. The account's five Cron Triggers are in use, so production's nightly run resets it.
   */
  PRESENTER?: { run(): Promise<void> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** What a Cron Trigger passes to `scheduled`: the expression that fired and when it was due. */
interface ScheduledController {
  cron?: string;
  scheduledTime?: number;
}

type Handler = (request: Request) => Promise<Response>;

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  actions,
  functions,
  links,
  mcp,
  objects,
  reset,
};

/** Set once this isolate has seen the database at (or past) the version this build needs. */
let schemaCurrent = false;

/** Hyperdrive when bound, otherwise the DATABASE_URL secret. */
export function connectionStringFor(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;
}

/**
 * One Postgres pool per request. The Worker never changes the schema: it reads the schema version
 * once per isolate and refuses requests while the database is behind this build (run `npm run
 * migrate`, or the Reseed workflow with mode migrate, then reload). A behind database is read again
 * on the next request, so the Worker recovers as soon as the migration lands.
 */
async function openDb(env: Env): Promise<Db> {
  const url = connectionStringFor(env);
  if (!url) {
    throw new HttpError("The database is not configured", 503);
  }
  const db = createPgDb(url);
  if (!schemaCurrent) {
    try {
      schemaCurrent = (await schemaVersion(db)) >= LATEST_MIGRATION;
    } catch (e) {
      await db.close().catch(() => {});
      throw e;
    }
    if (!schemaCurrent) {
      await db.close().catch(() => {});
      throw new HttpError("The database schema is behind this build", 503);
    }
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

/** The nightly reset: the same reset (and throttle) as the demo bar's button, then the due signals. */
async function nightlyReset(env: Env, ctx: ExecutionContext): Promise<void> {
  const res = await withDb(env, ctx, async () => {
    const resetRes = await reset.POST();
    return resetRes.ok ? json(await applyDueSignals(await getDb())) : resetRes;
  });
  if (!res.ok) {
    throw new Error(`Nightly reset failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * The presenter deployment's nightly reset, called by production's 04:00 UTC run through a service
 * binding. A named entrypoint is reachable only through a binding, never from the internet.
 */
export class PresenterNightly extends WorkerEntrypoint<Env> {
  async run(): Promise<void> {
    await nightlyReset(this.env, this.ctx);
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
      // /api/mcp is a POST that only reads; it is limited like the write routes, since a model can loop.
      const limiter = {
        actions: env.ACTIONS_LIMITER,
        reset: env.RESET_LIMITER,
        mcp: env.MCP_LIMITER,
      }[m[1] as "actions" | "reset" | "mcp"];
      // A limited MCP call is answered as a JSON-RPC error, like every other refusal on that route.
      const refused = await checkRate(
        limiter,
        request,
        m[1] === "mcp" ? (message) => rpcFailureBody(rpcCodeForStatus(429), message) : undefined,
      );
      if (refused) {
        return refused;
      }
    }
    return withDb(env, ctx, () => handler(request));
  },

  /**
   * The Cron Triggers. The hourly run at 04:00 UTC, or the nightly-only trigger, is the nightly reset: it runs the same reset (and
   * throttle) as the demo bar's button, then applies the market signals that have come due. Every
   * other run only applies them, a bounded batch per run. Only those two expressions reset: any other
   * trigger (or none) applies the due signals and nothing more, the safe direction.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const due = new Date(controller.scheduledTime ?? Date.now());
    const nightly =
      controller.cron === NIGHTLY_CRON ||
      (controller.cron === HOURLY_CRON && due.getUTCHours() === NIGHTLY_HOUR_UTC);
    if (nightly) {
      await nightlyReset(env, ctx);
      // The presenter's reset runs after this one and never blocks it; a failure still fails the run.
      await env.PRESENTER?.run();
      return;
    }
    const res = await withDb(env, ctx, async () => json(await applyDueSignals(await getDb())));
    if (!res.ok) {
      throw new Error(`Market signals failed: ${res.status} ${await res.text()}`);
    }
  },
};
