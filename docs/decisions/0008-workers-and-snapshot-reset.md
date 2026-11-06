# 0008. Cloudflare Workers and a snapshot-based reset

Status: Accepted

## Context

The public demo is shared and writable, so it has to return to a known state on a schedule. The seed builds the world through the real actions, which takes thousands of queries and about a second of CPU. That is over a Cloudflare Worker's free-plan CPU budget, so rebuilding on every reset inside the Worker does not fit.

## Decision

- **Hosting.** The Vite build is served as static assets with a single-page-app fallback, and `/api/*` runs in one Worker (`worker/index.ts`) over Neon Postgres. Locally the same SQL runs on PGlite.
- **Snapshot.** `npm run seed` builds the world once and copies every demo table to `snapshot_*` tables. A reset restores them in one transaction (truncate, then insert from the snapshot), moving every timestamp, and the dates embedded in search names and drift details, forward by the time since the snapshot. Visitors see the old world or the new one, never a half-built mix, and the result matches a full rebuild at that moment.
- **Triggers.** A Cron Trigger runs the reset at 04:00 UTC, and the demo bar's Reset button runs the same code. Both share one atomic throttle of one reset per five minutes.
- **Operations metrics** (`ActionRun`, `ModelCall`) are not part of the snapshot and are cleared by every reset.

## Consequences

- A reset fits the Worker's budget, and the demo is ephemeral by design: anything a visitor enters is deleted by the next reset.
- A snapshot taken before a property was added restores that column empty until the next `npm run seed` (the "Reseed" workflow runs it against production or the presenter database). The schema itself is applied on cold start by `ensureSchema`.
- Every request opens a fresh Postgres connection from the Worker, which is where most of the latency is (see [0009](0009-hyperdrive-connection-pooling.md)).
- The Worker needs `nodejs_compat` for `pg` and `node:crypto`, and the PGlite module is aliased out of the bundle.

## Code

`worker/index.ts`, `wrangler.jsonc`, `server/seed/snapshot.ts`, `api/reset.ts`, `.github/workflows/reseed.yml`. See [architecture.md](../architecture.md#demo-operations).
