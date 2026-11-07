# Architecture

Beacon is a React app over a small TypeScript backend. One schema file describes the whole data model, every write goes through a named action, and the rubric is one module that both the browser and the server import.

```mermaid
flowchart LR
  UI[React app<br/>8 screens] -- "useOsdkObjects / useOsdkAction<br/>(TanStack Query)" --> API[/api/objects · links · actions · functions · reset/]
  API --> Actions[Action handlers<br/>one transaction each]
  Actions --> Rubric[Shared rubric<br/>shared/scoreMirror.ts]
  UI --> Rubric
  Actions --> Agent[Enrichment agent<br/>mock providers + reconciliation]
  Actions --> Cluster[Rule clustering<br/>Claude → heuristic fallback]
  Actions --> PG[(Postgres<br/>18 object tables)]
  Schema[shared/schema.ts<br/>the ontology] -.-> PG
  Schema -.-> API
  Schema -.-> UI
```

## Ontology first

`shared/schema.ts` declares the 18 object types (firms, mandates, searches, findings, model extractions, scores, decisions, drift events, rules, hard-screen configs, market signals, the search join objects, the information-barrier objects (restricted firms, mandate access grants and the access log), and the operations records, action runs and model calls), their properties and types, the two links the UI traverses, and the 18 action names. Everything else derives from it:

- **Storage.** One Postgres table per object type, with quoted camelCase columns that match the property names, created by numbered SQL migrations in `server/db/migrations/` (`0001_baseline.sql` is the whole schema as it stood when migrations began, written to be idempotent so it adopts a database created earlier). `server/db/migrate.ts` applies the ones a database has not recorded in its `schema_migrations` table, in order, in one transaction behind an advisory lock (so concurrent runs apply each version once, and a failing migration changes nothing), with a 5 s lock timeout so live traffic waits at most that long behind an `ALTER TABLE` before the run gives up and can be retried. `npm run migrate` runs it against `DATABASE_URL`, the seed and the tests run it on their own databases, and the Worker never changes the schema: once per isolate it reads the recorded version, and while that is below the build's latest it answers every `/api/*` request 503 ("The database schema is behind this build") and keeps serving the static pages. A migration that has shipped is never edited; a change is a new file, and `npm run migrations:gen` bundles the files into `server/db/migrations.generated.ts`, which the Worker imports (a test fails when the two differ). `server/db/ddl.ts` still renders the schema from `shared/schema.ts`, but only for a test that checks the migrated database has exactly those tables, columns and types, so a property added without a migration fails CI. A saved demo snapshot taken earlier restores the new column empty until the next `npm run seed`.
- **Repository.** `server/db/repo.ts` reads and writes by object type. Every column name that reaches SQL is checked against the schema first, and every value is a bound parameter, so a request can't name a column that doesn't exist or inject SQL.
- **API.** `GET /api/objects` lists one type with `$eq` filters and ordering, a page at a time (`pageSize` up to 1000 and an opaque `pageToken`). `POST /api/links` follows a link for many source objects in one query, `POST /api/actions` applies a named action and reports which object types it wrote, and `GET /api/functions` runs a named, read-only query function so the browser receives numbers or a small result instead of rows. `POST /api/mcp` is a further route that is not for the browser: a stateless Model Context Protocol endpoint (JSON-RPC 2.0 over Streamable HTTP, hand-rolled in `server/mcp/rpc.ts`) with three read-only tools, `search_firms`, `get_firm_evidence` and `list_rules`, built on the same repository and access helpers and the Desk's own axis and citation code. It takes the persona from the same header and is rate limited per IP; [mcp.md](mcp.md) documents it. The query functions are:
  - `homeSummary`: everything Home shows (inbox, funnel, trust figures, trends, mandates, agent activity), aggregated in SQL and the shared rules.
  - `accuracySummary`: the Accuracy page's tables (agreement and abstention by source and by axis) and the outcomes of the firms behind them.
  - `sourceDocument`: the source document one provider holds for one firm, rendered on demand for the source drawer.
  - `firmObservations`: what each provider said about each axis of a firm, and whether its quote held up against its document.
  - `operationsSummary`: the Accuracy page's Operations tab: p50 and p95 duration, run and error counts per action, and live Claude spend per UTC day against the daily call cap, since the last reset.
  - `shellCounts`: the open-firm, review and active-mandate counts the sidebar and status bar show on every route, counted in SQL so no screen pays for the full Home summary.
- **Information barrier (demo).** Every API call may carry an `X-Beacon-Persona` header (`analyst`, `deal_lead` or `compliance`; missing or unknown is `analyst`). It is unauthenticated and demo-only. Each handler calls `resolveAccess(request)` in `server/access.ts` once, which loads the restricted firms, the mandate grants and the codenames in one query, and the result is passed to the repository and to every query function and action, so the wall is applied where data leaves the database rather than in the screens. `GET /api/objects?type=<Type>&id=<key>` returns one object as `{ data }`, with the same 404 for a missing object and one the persona may not see. A `403` means the type (`RestrictedFirm`, `AccessLogEntry`, `MandateAccess`) is for compliance alone, and a `400` means a filter or sort on a name field (`Mandate.title` or `intentStatement`, `Search.name`, `SearchList.name`) was refused to a persona with a mandate walled from it, because it would confirm a guess at the real title. Responses carry `Vary: X-Beacon-Persona`. [security.md](security.md#information-barriers-demo) states the rules.
- **Frontend.** `src/data/hooks.ts` exposes typed hooks keyed by the same type names. They keep the OSDK hook names the pages were written against, so the screens didn't change when the backend did. `useOsdkQuery` calls a query function, and a successful action refreshes only the object types it wrote, the links that touch them, and the function results.

Locally the database is PGlite (Postgres compiled to WebAssembly, persisted under `.data/`). In production it is Neon Postgres. The same SQL runs on both.

## Actions

Every write is an action in `server/actions/`, registered by name. Applying one:

1. Checks the demo's ceilings (activity tables, mandates, searches) so a single visitor can't fill the shared database.
2. Validates the parameters against the action's spec: types, lengths, list sizes, and object references. Referenced objects are loaded `FOR UPDATE`, so two concurrent actions on one firm run one after the other.
3. Runs the handler inside one transaction and returns the ids it created or modified, plus an optional note for the UI.
4. Records one `ActionRun` (action name, start time, duration, outcome and, on failure, the error kind) after the transaction ends, so the measurement is never part of it and a failure to record it never changes the action's result. Parameters and visitor identity are not recorded.

Live Claude calls (clustering, when switched on) record a `ModelCall` the same way, with the token counts the API reported and a cost computed from the price table in `server/extraction/pricing.ts`. Both are operations metrics, not demo data: they are left out of the reset snapshot, cleared by every reset, and capped at 10,000 stored action runs. The seeded history is built through the same actions but records nothing.

History is append-only, and the database holds it to that. A trigger on each history table (`qualification_score_append_only`, `review_decision_append_only` and `research_finding_append_only`, migration 0003) refuses the write. Qualification scores and review decisions are never updated or deleted. A research finding is never deleted and only ever changes its verification status and stamp (`findingStatus`, `verifiedByHuman`, `verifiedBy`, `verifiedAt`); an analyst override creates a new finding instead of editing the agent's. A drift event only changes its status and resolution, and a proposed rule or a hard-screen config only its status and active flag: those limits are application code, with no trigger behind them. TRUNCATE fires no row trigger, so the nightly reset still clears and rebuilds the history.

The same migration puts the references and the required columns in the database. Every `firmId`, `mandateId`, `searchId` and `sourceProposedRuleId` that names another row is a foreign key, checked at commit (`DEFERRABLE INITIALLY DEFERRED`, so the seed and the reset can insert tables in any order inside their one transaction). The reference columns and always-set timestamps that `shared/schema.ts` lists as `required` are NOT NULL. A proposed rule is unique on its predicate (axis, operator, threshold and model, compared as `ruleKey` does: trimmed, case-insensitive, an empty model meaning both), so two clustering runs racing to propose the same rule cannot both land: the later one leaves the existing rule and says so in its note.

## The enrichment agent

Each synthetic firm has a hidden true value per rubric axis. Four mock providers observe it, each covering a subset of axes with its own coverage and error rate:

| Provider   | Trust | Coverage | Error rate |
| ---------- | ----- | -------- | ---------- |
| BeaconDB   | 1     | 25%      | 2%         |
| Deal DB    | 2     | 70%      | 10%        |
| Filings    | 3     | 60%      | 5%         |
| Web search | 4     | 55%      | 20%        |

The agent works in four steps. Each step is a pure module, so each can move to a Foundry Function or AIP Logic function unchanged.

1. **Source records** (`server/extraction/documents.ts`). Each provider's observations for a firm are rendered as a readable record: an internal profile, a deal-league entry, a filings summary, or an "About us" page. A record states that provider's values, including its deliberate errors, in plain sentences around neutral filler. Records are pure functions of provider and firm, and a version string plus a hash identify exactly what was read.
2. **Extraction** (`server/extraction/contract.ts`). One module holds the prompt, the input (a firm's four records), and the output schema: per provider and axis, a value and the exact sentence it came from, or nothing. Claude runs this offline (`npm run extract`), one call per firm. A rule-based extractor produces the same shape for firms without a recorded answer.
3. **Grounding** (`server/extraction/grounding.ts`). An answer is kept only if:
   - the provider covers that axis;
   - the value is valid for the axis;
   - the quote appears word for word in that record (ignoring whitespace) and is at least a short sentence;
   - the quote contains the value, with numbers matched as whole tokens, so "5" does not match "$85 million".

   A rejected answer is dropped. If that leaves an axis with no support, the axis abstains with an excerpt saying the answer had no supporting quote.

4. **Reconciliation** (`server/enrichment/reconcile.ts`) turns one axis's grounded observations into findings:
   - **No observations → abstention.** The agent records that no source supported a value instead of guessing. Abstention is a first-class outcome: it tells the analyst exactly where their judgment is needed, and the Accuracy page reports the abstention rate as a trust signal.
   - **Agreement → one corroborated finding**, credited to every agreeing provider (for example "Deal DB + Filings").
   - **Disagreement → a conflict.** The two most trusted positions are surfaced as a pair and the agent never picks a winner. The analyst resolves it, and the other finding is marked rejected.

Each finding stores the record id, the exact quote, and the extraction model. On the desk, **View source** opens the record with the quote highlighted.

**Why offline.** Model answers are recorded once and committed as fixtures (`fixtures/extraction/`), with tokens, cost, and latency per firm. The seed loads them as `Extraction` objects, and the live **Run agent** button grounds those stored answers again. Visitors therefore spend nothing, the demo is reproducible, and the same fixtures feed evaluation. A stored answer is used only when its record hash and prompt version match the current code. Otherwise the firm falls back to the rule-based extractor, and the seed prints how many fixtures were current or stale.

**Recorded run (Claude Haiku 4.5, Message Batches API, prompt `extract-v1`, records `doc-v1`).** All 700 firms were extracted and parsed. Of 6,472 extracted values, 6,455 passed the grounding check. The 17 that did not are 16 true/false answers for web activity whose quote did not contain the value and one label that was not in its quote (`npm run eval` recomputes the figure, which is in [evals.json](evals.json)). That rate measures whether each answer quotes its record faithfully, not whether the value is correct: the records include each provider's deliberate errors, and reconciliation and analyst review handle those. The run cost $1.39. The recorded clustering of the seed's rejections (4 rule proposals, re-recorded after the grounding check tightened) cost a further $0.04.

**Showcase.** The seed leaves the agent's runs open on twelve firms (both business models). It picks them for source conflicts and abstentions and keeps them out of every screen, so the desk opens on a live run.

## Scoring as shared code

`shared/scoreMirror.ts` is the rubric: nine scored axes, each 0, 1, or 2 (18 points), recorded beside four pass or fail gates that earn no points (the desk lists six or seven scored axes with the gates, and scores the rest from the firm record), separate tables for the corporate-finance and capital-solutions theses, hard rejects, and A/B/C tiers. The desk imports it to preview a firm's score as the analyst accepts findings. The server imports the same module when it writes a score snapshot. There is one implementation, so the preview and the record can't disagree.

## Run agent → Accept → Commit

```mermaid
sequenceDiagram
  actor Analyst
  participant Desk as Enrichment desk
  participant API as /api/actions
  participant DB as Postgres

  Analyst->>Desk: Run agent
  Desk->>API: runAgentEnrichment(firm)
  API->>API: observe providers, reconcile per axis
  API->>DB: insert proposed / abstained / conflicting findings
  DB-->>Desk: findings (refetch)
  Analyst->>Desk: Accept findings, resolve conflict, fill an abstained axis
  Note over Desk: Staged locally; score preview<br/>from the shared rubric
  Analyst->>Desk: Commit
  Desk->>API: enrichFirm(values, fieldsEnteredManually)
  API->>DB: update firm, analyst findings for manual values,<br/>score snapshot, decision, drift check
  Desk->>API: verifyFinding(accepted findings)
  API->>DB: mark findings verified
  DB-->>Desk: fresh firm, score, and findings
```

## The learning loop

1. **Cluster.** `clusterRejections` gathers every pass decision (a `reject` review decision) with its rationale and the firm's facts. Claude proposes predicates on one firm fact at a time (structured output validated against a schema). When Claude is off, throttled, or fails, a keyword heuristic proposes instead.
2. **Ground.** Every proposal, from either source, is checked against the data. A pass only counts as support if its firm actually satisfies the predicate, and a proposal needs four distinct firms. Duplicates of existing rules, including dismissed ones, are dropped.
3. **Project.** Each surviving proposal records how many firms in the current queue it would screen.
4. **Approve.** Nothing screens until an analyst approves it. Approval writes a versioned hard-screen config, and amending the threshold writes a new version. Unapproving or dismissing deactivates it.
5. **Screen.** The desk's queue drops firms that trip an active config.

## Drift

When the live score of a firm at Qualified or any later stage, or of a Passed firm, moves after its last decision, Beacon raises a drift event. Firms at Qualified or later (Qualified through Closed) drift on any tier change. Passed firms drift only when they improve, because the reason for passing may no longer hold. A passed firm later acquired by a competitor raises an "outcome diverged" event. The Review page lets the analyst re-engage a passed firm, keep it passed with a rationale, or acknowledge the drift on a firm that stays in the pipeline.

## Market signals

Market signals are synthetic: invented news about a firm (a senior hire, a departure, a deal announcement, an acquisition) that makes a decided firm move without anyone touching it, and every screen that shows one is labelled "Synthetic market signal". The seed generates about 48 of them from a seeded random source, dated from 21 days before the seed to 23 hours after it. Those dated before the seed are applied while the demo is built, so their findings, score changes and drift events are part of the seeded history. The rest stay unapplied in the snapshot. An hourly Cron Trigger (the same one whose 04:00 run is the nightly reset) applies the signals that have come due, at most 10 per run, in one transaction: the pure planner `server/signals/apply.ts` decides what each writes (a finding with its own `signal` status, never `verified`, with no quote and no confidence; a change to a value the firm already had; a new score version) and `server/signals/run.ts` writes it, sets `appliedAt`, and opens a drift event through the same rule `enrichFirm` uses, or an "outcome diverged" event for an acquisition of a passed firm. A signal that already has `appliedAt` is never applied twice, and one that changes nothing (the axis has no value, an analyst verified it after the news, or the move is a no-op) is stamped applied with effect `unchanged` and shown as "No change". Where a signal and a human check disagree, the newer one wins everywhere: the apply step skips a signal an analyst has verified since its date, and the desk, tear sheet and exports show the signal when it is newer than the check (one shared rule, `signalOutranksCheck`), so the value shown is the value scored. A signal never settles an axis the agent abstained on. The nightly reset restores the unapplied signals with the rest of the snapshot, so they replay each day, and the findings they write are left out of the trust figures because they are news, not a reading of a source.

## Demo operations

- **Seed through the real actions.** `server/seed/` generates the 700-firm universe, then produces a month of history (mandates, searches, enrichment, qualifications, clustered passes, an approved rule, outcomes, and drift) by calling the same action handlers the UI calls. The seed doubles as an end-to-end test of the backend.
- **Reset.** `npm run seed` builds the world once and saves it as `snapshot_*` tables. A reset restores them in one transaction (TRUNCATE, then INSERT…SELECT with every timestamp moved forward by the time since the snapshot; no date lives inside text, so there is nothing else to rewrite: a search's name is its mandate's title and the screens show its run date from `runAt`, and a drift event's time is `detectedAt`), so visitors see the old world or the new one, never a half-built mix, and the result matches a full rebuild at that moment. A nightly Cloudflare Cron Trigger and the demo bar's Reset button share an atomic throttle of one reset per five minutes.
- **Claude cost guard.** At most one Claude clustering call per 10 minutes and 24 per day across all visitors. Both limits are claimed atomically before the action's transaction opens, so a rollback can't refund them.
- **Ceilings.** Parameter length and list caps, at most 25 mandates and 50 searches, and 10,000 activity rows until the next reset.
- **Latency.** Ten `GET /api/objects?type=Mandate` calls from Los Angeles, measured November 2026: p50 0.83 s, min 0.75 s, max 1.19 s. That was unchanged from before Smart Placement was turned on (p50 0.82 s), and the Worker still runs at the edge (`cf-placement: local-LAX`). Most of each request was the Postgres connection handshake from the Worker to Neon. With Hyperdrive pooling that connection (enabled November 2026, query caching off), the same ten calls gave p50 0.54 s, min 0.25 s, max 0.73 s, against p50 1.03 s, min 0.82 s, max 2.00 s just before ([0009](decisions/0009-hyperdrive-connection-pooling.md)).
