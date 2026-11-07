# Production roadmap

Beacon is a demo on synthetic data. This page lists what a production deployment would need and, for each item, what exists today and what is missing. Everything marked "mock" or "not built" below really is: the four data providers are deterministic generators, the firms are invented, and there are no accounts. [security.md](security.md) states the current trust posture claim by claim; the in-app [About](https://beacon.lukeghanna.com/about) and [Trust](https://beacon.lukeghanna.com/trust) pages summarise it.

## 1. Real data connectors

- **Now.** The four sources (BeaconDB, Deal DB, Filings, Web search) are mock providers: pure functions of provider, firm and axis, with set coverage and error rates (`server/enrichment/providers.ts`). Their "source records" are generated text (`server/extraction/documents.ts`), and the 700-firm universe is generated (`server/seed/universe.ts`). Claude's reading of those records is real and recorded (`server/extraction/`, `fixtures/extraction/`), but the records it reads are not.
- **Production needs.** Connectors to licensed data sources behind the same observation shape, with the licence terms deciding what may be stored and shown. A refresh cadence per source, with stored records versioned so that a changed source triggers re-extraction and the drift review rather than a silent overwrite. Per-source rate limits, retries and failure reporting. The grounding check, the conflict and abstention rules, and the fixture-style recorded answers carry over unchanged; the mock error rates would be replaced by measured ones (see item 4).

## 2. Sign-in and permissions

- **Now.** No sign-in. A demonstration of an information barrier exists (three demo personas sent in a request header, restricted firms, mandate codenames; see `docs/security.md`), but the header is not an identity. There is one shared analyst, `demo-analyst`, stamped on every decision (`shared/vocab.ts`), and the API is open (`worker/index.ts`, `api/`). The original Foundry build had sign-in and an organisation marking on every action; the port dropped them (`docs/foundry-origins.md`).
- **Production needs.** Single sign-on, named users, and roles (analyst, reviewer, administrator). Mandate-level need-to-know, so that analysts see only the mandates and firms they are staffed on. A permission check inside each action in `server/actions/` before anything is written, with decisions attributed to the real user instead of a constant.

## 3. Monitoring

- **Now.** Cloudflare Worker observability is switched on (`wrangler.jsonc`). Extraction spend is capped and recorded per firm (`server/extraction/budget.ts`, fixtures with tokens and cost), and live Claude clustering is limited to one call per 10 minutes and 24 per day (`server/clustering/choose.ts`). The app has no error tracking, latency dashboards or alerting of its own.
- **Production needs.** Error reporting for the Worker and the browser, request latency per route against a stated target, and alerts on failed or stalled extraction batches. Model spend and token use tracked per run and per mandate, with an alert before a budget is reached rather than only a cap that stops the run.

## 4. Evaluation on real data

- **Now.** The Accuracy page reports agreement, abstention and outcomes from the demo's own history (`src/accuracy/`, `src/desk/trustMetrics.ts`). The grounding rate (6,455 of 6,472 recorded values) shows that answers quote their record faithfully, and says nothing about whether a value is true, because the mock records contain deliberate errors (`docs/architecture.md`).
- **Production needs.** A labelled sample of real firms with analyst-confirmed values per axis, scored for each source and for the model's extraction, so that accuracy is measured rather than inferred. A re-run of that evaluation whenever the prompt version, the model or a source changes, plus a regular check for drift in extraction quality (for example the rate of dropped quotes and of abstentions by axis over time).

## 5. Audit export

- **Now.** Scores, findings, decisions and drift events are written as history through named actions (`server/actions/`, `server/actions/apply.ts`), and each firm's History tab shows its trail. Scores, decisions and findings are append-only in the database through triggers (`server/db/migrations/0003_integrity.sql`), and the nightly reset truncates the history, which a trigger does not stop (`server/seed/snapshot.ts`).
- **Production needs.** An export of the trail (who, what, when, which evidence) in a form compliance can file or query. A database role that owns none of the tables and has no UPDATE, DELETE or TRUNCATE on the history, so immutability does not depend on the Worker's connection string staying private (the triggers do not stop the table's owner). A history that is never truncated, with the user identity from item 2 on every row.

## 6. Retention and deletion

- **Now.** Everything is cleared on a schedule: a nightly Cron Trigger and the Reset button restore a saved snapshot (`wrangler.jsonc`, `api/reset.ts`, `server/seed/snapshot.ts`). Backup and retention on the Neon host are set in that provider's console, not in this repository.
- **Production needs.** An explicit retention period per record type, deletion on request and at expiry, and a clear rule for what happens to history that refers to deleted records. Backups with a defined restore objective, and a decision on whether source records and model outputs are kept for the length of the audit trail or shorter.

## 7. Tenant isolation

- **Now.** One database, one shared demo, no organisation concept (`shared/schema.ts`, `server/db/migrations/`). Every visitor reads and writes the same rows.
- **Production needs.** A tenant identifier on every object type in the schema, enforced by row-level security in Postgres rather than only by query filters, and tenant-scoped rate limits and spend caps. Separate keys and fixtures per tenant, so one organisation's mandates, rationales and rules never feed another's clustering or evaluation.
