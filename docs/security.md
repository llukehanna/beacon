# Security and trust

This is what Beacon does with data, models and access, as the code stands. Beacon is a public demo with synthetic data, not a production system, and where something is not built this document says so. Each claim ends with an HTML comment naming the file it comes from, and `server/trustClaims.test.ts` fails if a figure here drifts from that code.

The [Trust page](https://beacon.lukeghanna.com/trust) in the app summarises this document.

## Data handling

- Every firm is synthetic. Names are generated from invented words, and any resemblance to a real firm is coincidental. <!-- source: server/seed/universe.ts, README.md -->
- The universe is 700 firms. <!-- source: server/seed/universe.ts -->
- The "source documents" the agent reads are generated records labelled "Mock source", and some contain deliberate errors. No real company data, licensed data or personal data is loaded. <!-- source: server/extraction/documents.ts, README.md -->
- Text a visitor types (mandate descriptions, pass rationales, values entered by hand) is stored in the one shared database. Anyone using the demo can read it until the next reset, so do not enter anything real. <!-- source: api/objects.ts, server/actions/search.ts, server/actions/common.ts -->
- The API has no authentication. Reads are open to anyone who can reach the site. <!-- source: worker/index.ts, api/objects.ts -->

## Tenancy

- There is one shared demo and one shared analyst. Every decision is stamped with the same user name, `demo-analyst`. <!-- source: shared/vocab.ts, server/actions/apply.ts -->
- There are no accounts, sign-in, organisations or per-user permissions. The only roles are three demo personas for the information barrier, chosen by anyone; see Information barriers (demo). <!-- source: worker/index.ts, docs/foundry-origins.md, server/access.ts -->
- The Foundry original had OAuth and an organisation marking on every action. That was left out of the port because a public demo has one shared analyst. <!-- source: docs/foundry-origins.md -->
- A production deployment would need what the demo leaves out: sign-in, one tenant per organisation with row-level isolation in the database, and permission checks on each action. None of that is built. <!-- source: docs/foundry-origins.md, server/actions/apply.ts -->

## Secrets

- The production Worker reads one secret, `DATABASE_URL` (a Neon Postgres connection string), set with `wrangler secret put`. <!-- source: README.md, worker/index.ts -->
- If a Hyperdrive binding is configured, the Worker uses it instead of the secret. It is commented out in the checked-in config. <!-- source: wrangler.jsonc, worker/index.ts -->
- GitHub Actions secrets hold `ANTHROPIC_API_KEY` (the extraction workflow), and `DATABASE_URL_PRODUCTION` and `DATABASE_URL_PRESENTER` (the reseed workflow). <!-- source: .github/workflows/extract.yml, .github/workflows/reseed.yml -->
- The browser bundle reads no environment value other than the build's base path, and holds no key or connection string. <!-- source: src/router.tsx -->

## Retention

- The demo is restored from a saved snapshot every night at 04:00 UTC by a Cloudflare Cron Trigger. The restore truncates every demo table and reloads the snapshot in one transaction, so anything entered since the last reset is deleted. <!-- source: wrangler.jsonc, worker/index.ts, server/seed/snapshot.ts -->
- Anyone can also press the demo bar's Reset button. One reset is allowed per 5 minutes across all visitors. <!-- source: api/reset.ts -->
- Within a demo day, history tables only grow (see Audit trail). A row ceiling of 10,000 activity rows stops a script from filling the database before the next reset. <!-- source: server/actions/apply.ts -->
- Operations metrics (an action's name, start time, duration and outcome; a live model call's token counts and cost) are stored without parameters or visitor identity, up to 10,000 action runs, and are cleared by every reset. <!-- source: server/operations/record.ts, server/seed/snapshot.ts -->
- The demo access log (which persona opened which firm or mandate, and when) keeps its newest 500 rows and is cleared by every reset. <!-- source: server/access.ts, server/seed/snapshot.ts -->
- Retention and backups on the database host (Neon) are set in that provider's console, not in this repository, and are not described here. <!-- source: README.md -->

## Model-provider data use

- Claude reads the synthetic source records offline, once per firm, through the Message Batches API (Claude Haiku 4.5) with `npm run extract`. The answers are committed as fixtures. <!-- source: scripts/extract.ts, README.md, docs/architecture.md -->
- The seed, the demo and CI read the committed fixtures and need no API key. A visitor pressing Run agent grounds stored answers again and calls no model. <!-- source: README.md, docs/architecture.md -->
- The recorded run extracted 6,472 values across all 700 firms; 6,455 passed the grounding check. It cost $1.39. Clustering the seed's rejections into rule proposals cost a further $0.04. <!-- source: docs/architecture.md -->
- The live app can make one kind of Claude call: rule clustering. It runs only when `CLAUDE_CLUSTERING=on`; otherwise a keyword heuristic proposes the rules. <!-- source: server/clustering/choose.ts -->
- The guard allows at most one Claude clustering call per 10 minutes and 24 per UTC day, across all visitors. Past either limit the heuristic runs instead. <!-- source: server/clustering/choose.ts, server/db/meta.ts -->
- Both limits are claimed atomically before the action's transaction opens, so a rolled-back action does not refund them. <!-- source: server/clustering/choose.ts, server/actions/apply.ts -->
- If the Claude call fails or times out (30 seconds, one retry), the heuristic proposes instead. <!-- source: server/clustering/choose.ts, server/clustering/claude.ts -->
- A clustering call sends the analysts' pass rationales (free text typed by visitors) with each decision's id and a few firm facts such as headcount and deal size. It does not send firm names or ids. <!-- source: server/clustering/claude.ts -->
- The documented production setup holds one Worker secret, `DATABASE_URL`, sets no `CLAUDE_CLUSTERING` variable and holds no Anthropic key, so as documented here live clustering is the heuristic. Enabling Claude means adding both. <!-- source: README.md, wrangler.jsonc, server/clustering/choose.ts -->
- How a model provider retains or uses API inputs is governed by that provider's terms, which this repository does not restate. <!-- source: server/clustering/claude.ts -->

## AI-risk notes

- **Grounding check.** A value the model returns is kept only if its quote appears word for word in the source record (ignoring whitespace) and is at least a short sentence, the quote contains the value, the value is valid for the axis, and the provider covers that axis. A rejected answer is dropped. <!-- source: server/extraction/grounding.ts, docs/architecture.md -->
- The check shows that an answer quotes its record faithfully. It does not show that the value is true: the mock records carry deliberate errors, which reconciliation and analyst review are there to catch. <!-- source: docs/architecture.md, server/enrichment/providers.ts -->
- **Abstention.** When no source supports an axis, the agent records an abstention instead of guessing, and the Accuracy page reports the abstention rate. <!-- source: server/enrichment/reconcile.ts, docs/architecture.md -->
- **Conflicts are surfaced, not hidden.** When sources disagree, the two most trusted positions are shown as a pair and the agent never picks a winner. The analyst resolves it. <!-- source: server/enrichment/reconcile.ts, server/actions/findings.ts -->
- **Scores are not model output.** The rubric is plain code, shared by the browser and the server. <!-- source: shared/scoreMirror.ts -->
- **Rules need a human.** A proposed rule needs at least four distinct firms behind it, is checked against the data, and screens nothing until an analyst approves it. Approval writes a versioned config. <!-- source: server/actions/rules.ts -->
- **Findings are not final.** An accepted value is marked verified only by an analyst action, and an analyst override creates a new finding rather than editing the agent's. <!-- source: server/actions/findings.ts, docs/architecture.md -->

## Audit trail

- Qualification scores and review decisions are only ever inserted, never updated. <!-- source: server/actions/common.ts -->
- A research finding is inserted once and afterwards changes only its status and verification stamp (for example superseded, verified, rejected). <!-- source: server/actions/findings.ts -->
- A drift event changes only its status and resolution fields. A proposed rule changes only its status and who decided it, and when. A hard-screen config is inserted per version, and its active flag is switched off when the rule is dismissed, unapproved or amended. <!-- source: server/actions/drift.ts, server/actions/rules.ts -->
- The firm record itself is current state and is updated in place. <!-- source: server/actions/firms.ts, server/actions/findings.ts -->
- **How this is enforced: in application code only.** Every write goes through a named action in the registry, and no action updates or deletes those history rows beyond the fields above. <!-- source: server/actions/registry.ts, shared/schema.ts -->
- The database does not enforce it. There are no triggers and no revoked privileges, and the Worker connects with one connection string that has full rights. A database-level guarantee (write-once tables, or a role without UPDATE and DELETE) is not built. <!-- source: server/db/migrations/0001_baseline.sql, worker/index.ts -->
- The API has no generic write endpoint. Reads (`/api/objects`, `/api/functions`), the link lookup (`/api/links`) and the read-only MCP endpoint (`/api/mcp`) change nothing but the demo access log; the only write routes are `/api/actions` and `/api/reset`. <!-- source: api/objects.ts, api/functions.ts, api/links.ts, api/mcp.ts, api/actions.ts, api/reset.ts -->
- The nightly reset truncates the history, so the trail covers one demo day, not a permanent record. <!-- source: server/seed/snapshot.ts -->

## Information barriers (demo)

- Beacon demonstrates an information barrier: restricted firms and need-to-know on mandates. It shows how a wall behaves; it is not a security control. <!-- source: shared/accessPolicy.ts -->
- **The identity is demo-only.** The persona (analyst, deal-team lead or compliance) is chosen in the sidebar, kept in the browser and sent in an `X-Beacon-Persona` request header. The server trusts the header and there is no sign-in, so anyone can send any value. A missing or unknown value is the analyst. <!-- source: shared/accessPolicy.ts, server/access.ts, src/data/persona.ts -->
- The Worker sets no CORS headers, and the header is sent same-origin, so the Content-Security-Policy needs no change for it. A page on another origin cannot read the API from a browser. <!-- source: worker/index.ts, server/http.ts, public/_headers -->
- Three firms are restricted, each with a reason. Only the compliance persona sees them. For the analyst and the deal-team lead they are left out of object lists, a lookup by key is a 404, links, every query function including the aggregate counts, and so of the lists that exports, tear sheets, lookalikes and the command palette are built from. <!-- source: server/access.ts, api/objects.ts, api/links.ts, api/functions.ts, server/functions/homeSummary.ts -->
- An action on a restricted firm, or on a finding, decision or drift event that belongs to one, is a 404, the same as an unknown id, and a search an analyst runs does not pull a restricted firm into its results. <!-- source: server/actions/params.ts, server/actions/search.ts -->
- Rule clustering run by a persona leaves out the decisions on firms hidden from it, so a restricted firm's rationale and decision ids cannot reach a proposed rule. A rule that rests on a decision about a restricted firm (one proposed by compliance) is read with that decision's id, its rationale and its place in the firm count removed, by the app's objects route and by the MCP alike, through one shared function. Other counts stored when something ran, such as a search's result count or the projected impact of a rule, can still include a restricted firm. <!-- source: server/actions/rules.ts, server/actions/search.ts, shared/accessPolicy.ts, api/objects.ts, server/barrier.test.ts -->
- Filtering or sorting on a field that carries a walled mandate's title (a mandate's title and intent, a search's or list's name) is refused with a 400 for a persona without need-to-know, so a guess at the title cannot be confirmed. <!-- source: api/objects.ts -->
- Need-to-know is a grant of a persona to a mandate. The deal-team lead and compliance hold every mandate; the analyst holds all but one. A persona without a grant still sees the mandate and its firms, but its title and free-text intent are replaced by its codename in lists, lookups, search names, Home and export file names. A mandate nobody has been granted is open. <!-- source: shared/accessPolicy.ts, server/seed/barriers.ts, server/functions/homeSummary.ts -->
- Opening a firm in detail (a lookup by key, a firm's observations or source document, a tear sheet) or a mandate adds a row to an access log: the persona, the object and the time. Writing it is best effort and never fails the read. <!-- source: server/access.ts, api/objects.ts, api/functions.ts -->
- The log keeps the newest 500 rows, a repeat view within 30 seconds counts once, and only the compliance persona can read it, together with the restricted list and the grants. <!-- source: server/access.ts, api/objects.ts -->
- **How this maps to Foundry.** A restricted firm becomes a Marking on the object, which hides it from everyone who does not hold the Marking, in search, object sets and links. Need-to-know becomes mandate-level Markings on a mandate's objects, or a restricted view that shows the codename to everyone and the real title to the holders. The persona becomes the signed-in user and their groups. <!-- source: docs/foundry-origins.md, shared/accessPolicy.ts -->
- **A real deployment would derive the persona from single sign-on, never from a header**, and would enforce the same rules in the data layer (Markings, or row-level security in the database), not only in the API. <!-- source: server/access.ts, docs/production-roadmap.md -->

## MCP server (read-only)

- Beacon offers a Model Context Protocol endpoint, `POST /api/mcp`, with three tools: `search_firms`, `get_firm_evidence` and `list_rules`. [mcp.md](mcp.md) documents it. <!-- source: api/mcp.ts, server/mcp/tools.ts, docs/mcp.md -->
- **Read-only.** The tools call only the repository's read helpers and build no SQL from input; the one write is the demo access log row that opening a firm adds, as in the app. Every tool is annotated read-only, and a test compares every table before and after a call. <!-- source: server/mcp/tools.ts, server/mcp/mcp.test.ts -->
- **Bounded.** A list returns at most 25 rows (a larger `limit` is clamped), a search reads at most three pages of firms, arguments are validated against each tool's schema with unknown ones refused, and the request body is capped like every other route. <!-- source: server/mcp/tools.ts, server/http.ts -->
- **Persona-respecting.** The endpoint reads the persona from the same `X-Beacon-Persona` header and applies the same wall. A restricted firm is left out of searches, a lookup of it is the same not-found as an unknown id, and a rule's firm count, decision ids and rationale leave out decisions on firms the persona cannot see (the same redaction as the app's rules page). A walled mandate named in a rule appears by its codename. The stored projected-impact count of a rule is the one counted when it was proposed, so a rule proposed by compliance can still include a restricted firm in that count. <!-- source: api/mcp.ts, server/mcp/tools.ts, server/barrier.test.ts -->
- **The identity is the demo's.** There is no authentication on the endpoint, and the persona is a header anyone can set. An assistant connected to it receives what that persona may see, and what the assistant's provider does with it is governed by that provider's terms. <!-- source: server/access.ts, api/mcp.ts -->
- The endpoint is stateless: no session, no event stream, and `GET` is refused with 405. <!-- source: server/mcp/rpc.ts, worker/index.ts -->

## Security headers and rate limits

The Content-Security-Policy served with every page and asset: <!-- source: public/_headers -->

```
default-src 'self'
script-src 'self' https://static.cloudflareinsights.com
style-src 'self' 'unsafe-inline'
img-src 'self' data:
font-src 'self' data:
connect-src 'self' https://cloudflareinsights.com
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

- The policy allows inline styles (`'unsafe-inline'` under `style-src`) and the Cloudflare analytics script and endpoint. Whether analytics is switched on is a setting in the Cloudflare dashboard, not in this repository. <!-- source: public/_headers -->
- Static assets also carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. API responses carry the same three headers and `Cache-Control: no-store`. <!-- source: public/_headers, server/http.ts -->
- `POST /api/actions` is limited to 60 requests per minute and `POST /api/reset` to 3 per minute, each per client IP. <!-- source: wrangler.jsonc, worker/rateLimit.ts -->
- `POST /api/mcp` is limited to 60 requests per minute per client IP. <!-- source: wrangler.jsonc, worker/rateLimit.ts, worker/index.ts -->
- A POST whose `Origin` header names another host is refused, and a request body must be JSON of at most 65,536 bytes. <!-- source: server/http.ts -->
- Action parameters are validated against each action's spec: strings up to 2,000 characters, lists up to 50 items of up to 200 characters. <!-- source: server/actions/params.ts -->
- The shared demo is capped at 25 mandates, 50 searches and 10,000 activity rows until the next reset. <!-- source: server/actions/search.ts, server/actions/apply.ts -->
- Column names reaching SQL are checked against the schema and every value is a bound parameter. <!-- source: server/db/repo.ts, docs/architecture.md -->

## Not built

- Authentication, accounts, real roles and per-user permissions. The information barrier's personas are a demo. <!-- source: worker/index.ts, server/access.ts -->
- Tenant isolation. <!-- source: server/db/migrations/0001_baseline.sql -->
- Database-enforced immutability of the audit trail. <!-- source: server/db/migrations/0001_baseline.sql -->
- Any compliance certification. None is claimed. <!-- source: README.md -->
