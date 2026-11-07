# 0009. Hyperdrive for the Worker's database connection

Status: Accepted (November 2026). Production connects through the `HYPERDRIVE` binding in `wrangler.jsonc`; `DATABASE_URL` remains the fallback.

## Context

Ten `GET /api/objects?type=Mandate` calls from Los Angeles, measured in November 2026, gave p50 0.83 s (min 0.75 s, max 1.19 s). Turning Smart Placement on did not change that (p50 0.82 s). Most of each request is the Postgres connection handshake from the Worker to Neon, because each request opens its own connection.

## Decision

Put Cloudflare Hyperdrive in front of Neon so the Worker reuses pooled connections instead of opening one per request.

`connectionStringFor` in `worker/index.ts` prefers a `HYPERDRIVE` binding when present and otherwise uses the `DATABASE_URL` secret, and `worker/index.test.ts` covers both. The config points at the direct Neon host, not Neon's own pooler, and has query caching off: with caching on, a read could return a result up to a minute old right after an action changed it.

## Consequences

- Measured with the same ten `GET /api/objects?type=Mandate` calls from Los Angeles, on one day in November 2026: p50 1.03 s, min 0.82 s, max 2.00 s directly; p50 0.54 s, min 0.25 s, max 0.73 s through Hyperdrive.
- Hyperdrive pools in transaction mode. Every session setting the code uses is transaction-scoped (`SET LOCAL`, `SET CONSTRAINTS`), and the demo reset (one transaction with `TRUNCATE`, deferred foreign keys and the history triggers) ran through it on the first deploy.
- The binding is per environment: the presenter deployment still connects with its secret.
- Removing the binding reverts to the direct connection; the `DATABASE_URL` secret is still set.
- Schema migrations run from the Reseed workflow with their own connection string, not through Hyperdrive.

## Code

`worker/index.ts` (`connectionStringFor`), `wrangler.jsonc`, [deploy.md](../deploy.md). See [architecture.md](../architecture.md#demo-operations).
