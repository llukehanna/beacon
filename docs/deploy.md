# Deploying Beacon

## Extraction

`npm run extract` has Claude (Haiku 4.5, Message Batches API) read every firm's four source records and writes the answers to `fixtures/extraction/*.jsonl`, with model, prompt version, document hash, tokens, and cost per firm. `--max-usd` (default 5) stops the run before the cap would be passed, planned against worst-case output. A rerun skips firms that already have a current record, and `--resume-batch <id>` collects a batch that was already paid for. The "Extract" GitHub Actions workflow runs the same command with the key from a repository secret and pushes the fixtures to a branch. The seed, the demo, and CI only read the committed fixtures, so they need no key. A firm with no current fixture falls back to a rule-based extractor that produces the same shape.

## Cloudflare Workers

Beacon runs on Cloudflare Workers (free plan): the Vite build is served as static assets with an SPA fallback, and `/api/*` runs in `worker/index.ts`. Smart Placement runs the Worker near the database, and `POST /api/actions` (60 per minute), `POST /api/reset` (3 per minute) and `POST /api/mcp` (60 per minute) are rate limited per client IP. Each deployment has one Cron Trigger, because the free plan allows five per account: production runs hourly, and its 04:00 UTC run is the nightly reset; every other run applies the synthetic market signals that have come due. The presenter deployment has no trigger of its own: production's 04:00 UTC run resets it through a service binding to its `PresenterNightly` entrypoint, which only a binding can reach. Deploy the presenter before production when that entrypoint changes.

**Production** (`beacon.lukeghanna.com`) reads one Worker secret: `DATABASE_URL` (Neon Postgres).

```bash
npx wrangler secret put DATABASE_URL
DATABASE_URL='<neon connection string>' npm run seed   # once, and after schema or seed changes
npm run deploy    # typecheck, vite build, wrangler deploy
```

**Hyperdrive (optional).** To pool and cache connections in front of Neon, create the config once, then uncomment the `hyperdrive` block in `wrangler.jsonc` and paste the id. The Worker uses the binding when present and falls back to `DATABASE_URL` otherwise.

```bash
npx wrangler hyperdrive create beacon-db --connection-string='<neon connection string>'
```

**Presenter environment.** A second deployment, `beacon-presenter`, serves the same build on a `workers.dev` URL with its own database and the same nightly reset (triggered by production; its signals are applied after that reset), so it can be edited live without touching production.

```bash
# 1. Create a Neon branch for it and copy its connection string.
npx wrangler secret put DATABASE_URL --env presenter
DATABASE_URL='<presenter branch connection string>' npm run seed
npm run deploy:presenter
# 2. In Cloudflare Zero Trust, add an Access application on the beacon-presenter workers.dev route.
```

**Reseeding.** The "Reseed" GitHub Actions workflow (manual dispatch, target `production` or `presenter`) runs `npm run seed` against the matching database secret (`DATABASE_URL_PRODUCTION` or `DATABASE_URL_PRESENTER`). Run it after schema or seed changes.

`npm run seed` builds the demo through the real actions and saves it as `snapshot_*` tables. The Reset button and the nightly reset restore that snapshot in one transaction, with timestamps moved forward to the moment of the reset, which keeps a reset within the Workers free plan's CPU budget.
