# Beacon

[![CI](https://github.com/llukehanna/beacon/actions/workflows/ci.yml/badge.svg)](https://github.com/llukehanna/beacon/actions/workflows/ci.yml)

Acquisition-target sourcing for a corporate development team. Analysts turn a mandate into a searched universe of advisory firms. An agent assembles cited evidence for each firm, a deterministic rubric scores and tiers every firm, and the reasons analysts reject firms become proposed screening rules for the next search.

**Live demo:** https://beacon.lukeghanna.com (synthetic data, resets daily)

![Enrichment desk: a conflict between two sources, cited proposals, and abstentions](docs/screenshots/desk.png)

## What it does

- **Mandate → search.** Scope a candidate universe by thesis (corporate finance or capital solutions), geography, product, and sector.
- **Agent enrichment with honest abstention.** Four mock data sources are queried in trust order. Agreement becomes one corroborated finding. Disagreement becomes an explicit conflict for the analyst. "No source has this" is recorded as an abstention instead of a guess.
- **Deterministic scoring.** An 18-point, nine-axis rubric per thesis, with hard rejects and A/B/C tiers. The same code runs in the browser for live previews and on the server for the record.
- **Append-only audit trail.** Scores, findings, and decisions are versioned, never edited.
- **A learning loop with a human in it.** Rejection rationales are clustered (by Claude, with a deterministic fallback) into proposed screening rules. Each proposal is checked against the data, shows how many firms it would screen, and only takes effect after an analyst approves it.
- **Drift.** When new evidence moves a qualified or passed firm's tier, or a passed firm is bought by a competitor, it resurfaces for review.

| Home | Rules | Review |
| --- | --- | --- |
| ![Home](docs/screenshots/home.png) | ![Proposed rules](docs/screenshots/rules.png) | ![Drift review](docs/screenshots/review.png) |

## Architecture

See [docs/architecture.md](docs/architecture.md).

```mermaid
flowchart LR
  UI[React app<br/>8 screens] -- "useOsdkObjects / useOsdkAction<br/>(TanStack Query)" --> API[/api/objects · links · actions · functions · reset/]
  API --> Actions[Action handlers<br/>one transaction each]
  Actions --> Rubric[Shared rubric<br/>shared/scoreMirror.ts]
  UI --> Rubric
  Actions --> Agent[Enrichment agent<br/>mock providers + reconciliation]
  Actions --> Cluster[Rule clustering<br/>Claude → heuristic fallback]
  Actions --> PG[(Postgres<br/>11 object tables)]
  Schema[shared/schema.ts<br/>the ontology] -.-> PG
  Schema -.-> API
  Schema -.-> UI
```

## Built on Palantir Foundry, then ported

Beacon was first built on Palantir Foundry (Ontology, Functions, Actions, AIP, OSDK). When that environment went away, the backend was rebuilt on an open stack behind the same frontend. [docs/foundry-origins.md](docs/foundry-origins.md) maps each Foundry concept to its replacement.

## Run it locally

Requires Node 22+.

```bash
npm install
npm run seed      # builds the demo world and its reset snapshot in .data/pglite (in-process Postgres)
npm run dev       # http://localhost:8080
```

`npm run check` runs the sanitization guard, lint, the formatting check, both typechecks, and the test suite.

Rule clustering uses a keyword heuristic by default. To use Claude, set `CLAUDE_CLUSTERING=on` and provide Anthropic credentials (`ANTHROPIC_API_KEY`). The public demo allows at most one Claude call per 10 minutes and 24 per day; everything else falls back to the heuristic.

## Deploy

Beacon runs on Cloudflare Workers (free plan): the Vite build is served as static assets with an SPA fallback, and `/api/*` runs in `worker/index.ts`. Smart Placement runs the Worker near the database, and `POST /api/actions` (60 per minute) and `POST /api/reset` (3 per minute) are rate limited per client IP.

**Production** (`beacon.lukeghanna.com`) reads two Worker secrets: `DATABASE_URL` (Neon Postgres) and `CRON_SECRET`.

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put CRON_SECRET
DATABASE_URL='<neon connection string>' npm run seed   # once, and after schema or seed changes
npm run deploy    # typecheck, vite build, wrangler deploy
```

**Hyperdrive (optional).** To pool and cache connections in front of Neon, create the config once, then uncomment the `hyperdrive` block in `wrangler.jsonc` and paste the id. The Worker uses the binding when present and falls back to `DATABASE_URL` otherwise.

```bash
npx wrangler hyperdrive create beacon-db --connection-string='<neon connection string>'
```

**Presenter environment.** A second deployment, `beacon-presenter`, serves the same build on a `workers.dev` URL with its own database and no cron, so it can be edited live without touching production.

```bash
# 1. Create a Neon branch for it and copy its connection string.
npx wrangler secret put DATABASE_URL --env presenter
DATABASE_URL='<presenter branch connection string>' npm run seed
npm run deploy:presenter
# 2. In Cloudflare Zero Trust, add an Access application on the beacon-presenter workers.dev route.
```

**Reseeding.** The "Reseed" GitHub Actions workflow (manual dispatch, target `production` or `presenter`) runs `npm run seed` against the matching database secret (`DATABASE_URL_PRODUCTION` or `DATABASE_URL_PRESENTER`). Run it after schema or seed changes.

`npm run seed` builds the demo through the real actions and saves it as `snapshot_*` tables. The Reset button and the nightly Cron Trigger restore that snapshot in one transaction, with timestamps moved forward to the moment of the reset, which keeps a reset within the Workers free plan's CPU budget.

## Project layout

| Path | What lives there |
| --- | --- |
| `shared/` | The ontology schema, rubric, vocabulary, taxonomy, predicates (used by both sides) |
| `server/actions/` | One module per domain; every write is a named, validated, transactional action |
| `server/enrichment/` | Deterministic mock providers and evidence reconciliation |
| `server/clustering/` | Claude and heuristic rule proposers |
| `server/seed/` | 700-firm synthetic universe and a history built by the real actions |
| `api/` | Thin HTTP adapters (`Request` → `Response`) |
| `worker/` | Cloudflare Worker: serves the built app, routes `/api/*`, runs the nightly reset |
| `src/` | The React app; `src/data/` is the typed data layer |

## Data

Everything is synthetic. Firm names are generated from invented words, and any resemblance to a real firm is coincidental. Enrichment sources are mocks that link to reserved `.example` domains.
