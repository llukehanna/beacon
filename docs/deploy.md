# Deploying Beacon

## Extraction

`npm run extract` has Claude (Haiku 4.5, Message Batches API) read every firm's four source records and writes the answers to `fixtures/extraction/*.jsonl`, with model, prompt version, document hash, tokens, and cost per firm. `--max-usd` (default 5) stops the run before the cap would be passed, planned against worst-case output. A rerun skips firms that already have a current record, and `--resume-batch <id>` collects a batch that was already paid for. The "Extract" GitHub Actions workflow runs the same command with the key from a repository secret and pushes the fixtures to a branch. The seed, the demo, and CI only read the committed fixtures, so they need no key. A firm with no current fixture falls back to a rule-based extractor that produces the same shape.

## Cloudflare Workers

Beacon runs on Cloudflare Workers (free plan): the Vite build is served as static assets with an SPA fallback, and `/api/*` runs in `worker/index.ts`. Smart Placement runs the Worker near the database, and `POST /api/actions` (60 per minute), `POST /api/reset` (3 per minute) and `POST /api/mcp` (60 per minute) are rate limited per client IP. Each deployment has one Cron Trigger, because the free plan allows five per account: production runs hourly, and its 04:00 UTC run is the nightly reset; every other run applies the synthetic market signals that have come due. The presenter deployment has no trigger of its own: production's 04:00 UTC run resets it through a service binding to its `PresenterNightly` entrypoint, which only a binding can reach. Deploy the presenter before production when that entrypoint changes.

CI boots the built Worker in `wrangler dev` with no database and checks that `/` serves and `/api/*` answers the Worker's own 503, which catches a bundle that fails to start in workerd (the unit tests run in plain Node).

**Production** (`beacon.lukeghanna.com`) reads one Worker secret: `DATABASE_URL` (Neon Postgres).

```bash
npx wrangler secret put DATABASE_URL
DATABASE_URL='<neon connection string>' npm run migrate   # every release that adds a migration, before the deploy
DATABASE_URL='<neon connection string>' npm run seed      # once, and after seed changes
npm run deploy    # typecheck, vite build, wrangler deploy
```

**Schema migrations.** The database schema is changed only by the numbered SQL files in `server/db/migrations/`, applied by `npm run migrate` (it applies what the database has not recorded in `schema_migrations`, in one transaction behind an advisory lock, and is safe to rerun). The Worker never changes the schema. Once per isolate it reads the recorded version, and while that is below the version the build needs, every `/api/*` request answers 503 `{"error":"The database schema is behind this build"}` and the static pages keep serving; it recovers on the first request after the migration lands.

**Release order.** A release that adds a migration goes out in this order, for production and then for the presenter:

1. Run the "Reseed" GitHub Actions workflow with `mode: migrate` (or `npm run migrate` against that database). The previous build keeps serving and running its actions on the migrated schema, but its seed may not (the previous build's `npm run seed` fails against 0003's append-only triggers), so run the Reseed workflow from the new build's branch, and treat a migration as one-way: reverting the code does not revert the schema. A migration may also rewrite data (0002 strips the date from search names; 0003 repairs any row that would break its new constraints, filling an empty required timestamp from a related row (or the time of the migration) and removing a row only when a required reference names nothing, and writes each repair, with the row as it was, to the `migration_repair` table: read it after migrating with `SELECT * FROM migration_repair`); rows the previous build writes before step 2 keep the old form until the reseed in step 3.
2. `npm run deploy` (or `npm run deploy:presenter`).
3. Run the "Reseed" workflow with `mode: reseed`, so the demo data and its reset snapshot are rebuilt by the new code.

To add a migration, write `server/db/migrations/NNNN_name.sql` (the next number, idempotent, never an edit to a shipped file; every pending migration runs in one transaction, so `CREATE INDEX CONCURRENTLY` is unavailable and a heavy rewrite holds the locks of the migrations before it until commit), run `npm run migrations:gen`, and commit both; a migration that rewrites `qualification_score`, `review_decision` or `research_finding` meets the append-only triggers of migration 0003 and its UPDATE or DELETE fails, so rewrite such a table the way `shiftLiveTimestamps` in `server/seed/snapshot.ts` does (copy the rows, changed, into a temporary table, `TRUNCATE` the table, which fires no row trigger, and insert them back; run `SET CONSTRAINTS ALL IMMEDIATE` first, because Postgres will not truncate a table with deferred foreign-key checks pending) or, in the migration only, drop and recreate the trigger around the statement; tests fail if the bundled copy is stale or if `shared/schema.ts` and the migrated schema disagree.

**Hyperdrive (optional).** To pool and cache connections in front of Neon, create the config once, then uncomment the `hyperdrive` block in `wrangler.jsonc` and paste the id. The Worker uses the binding when present and falls back to `DATABASE_URL` otherwise.

```bash
npx wrangler hyperdrive create beacon-db --connection-string='<neon connection string>'
```

**Presenter environment.** A second deployment, `beacon-presenter`, serves the same build on a `workers.dev` URL with its own database and the same nightly reset (triggered by production; its signals are applied after that reset), so it can be edited live without touching production.

```bash
# 1. Create a Neon branch for it and copy its connection string.
npx wrangler secret put DATABASE_URL --env presenter
DATABASE_URL='<presenter branch connection string>' npm run migrate
DATABASE_URL='<presenter branch connection string>' npm run seed
npm run deploy:presenter
# 2. In Cloudflare Zero Trust, add an Access application on the beacon-presenter workers.dev route.
```

**Reseeding and migrating.** The "Reseed" GitHub Actions workflow (manual dispatch, target `production` or `presenter`) runs against the matching database secret (`DATABASE_URL_PRODUCTION` or `DATABASE_URL_PRESENTER`). Its `mode` input is `reseed` (the default) or `migrate`. Both modes apply the pending migrations first; `reseed` then runs `npm run seed`, and `migrate` stops there. Use `migrate` before a deploy that adds a migration, and `reseed` after seed changes and after that deploy.

`npm run seed` builds the demo through the real actions and saves it as `snapshot_*` tables. The Reset button and the nightly reset restore that snapshot in one transaction, with timestamps moved forward to the moment of the reset, which keeps a reset within the Workers free plan's CPU budget.
