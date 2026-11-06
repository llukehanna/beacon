# 0009. Hyperdrive for the Worker's database connection

Status: Proposed. Not enabled: the binding is commented out in `wrangler.jsonc` and production connects directly with `DATABASE_URL`.

## Context

Ten `GET /api/objects?type=Mandate` calls from Los Angeles, measured in November 2026, gave p50 0.83 s (min 0.75 s, max 1.19 s). Turning Smart Placement on did not change that (p50 0.82 s). Most of each request is the Postgres connection handshake from the Worker to Neon, because each request opens its own connection.

## Decision (proposed)

Put Cloudflare Hyperdrive in front of Neon so the Worker reuses pooled connections instead of opening one per request.

Already in place: `connectionStringFor` in `worker/index.ts` prefers a `HYPERDRIVE` binding when present and otherwise uses the `DATABASE_URL` secret, and `worker/index.test.ts` covers both. A commented `hyperdrive` block in `wrangler.jsonc` and the README give the steps to enable it.

## Consequences if accepted

- Nothing has been measured with Hyperdrive on, so the latency gain is expected, not shown. Before accepting, repeat the same ten-call measurement with the binding on and compare it with the figures above.
- Actions run in transactions that lock the rows they touch (`FOR UPDATE`), so pooled connections must be checked against the end-to-end suite before the change is merged.
- The binding is per environment, so the presenter environment needs its own block.
- The `DATABASE_URL` secret stays as the fallback, so the change can be reverted by removing the binding.

## Code

`worker/index.ts` (`connectionStringFor`), `wrangler.jsonc`, `README.md` (Deploy). See [architecture.md](../architecture.md#demo-operations).
