# 0006. History that only grows, enforced in application code

Status: Accepted. Database-level enforcement is not built.

## Context

An acquisition screen needs an audit trail: what the score was, what the analyst decided and why, what evidence was on the table. A trail that can be edited is not one. There is a difference between saying history is append-only and enforcing it, and the claim should be exactly as strong as the enforcement.

## Decision

Every write is a named action, and the actions treat history this way (as `server/actions/` stands):

- `QualificationScore` and `ReviewDecision` rows are only ever inserted.
- A `ResearchFinding` is inserted once and afterwards changes only its status and verification stamp. An analyst override inserts a new finding.
- A `DriftEvent` changes only its status and resolution. A `ProposedRule` changes only its status and who decided it, and when. A `HardScreenConfig` is inserted per version and only its active flag is switched off.
- The `Firm` row is current state and is updated in place.
- The API has no generic write endpoint: the only write routes are `/api/actions` and `/api/reset`. (`/api/links` is a POST so it can take many keys in a body, but it only reads.)

## Consequences

- Three triggers enforce the first two rules in the database: `qualification_score_append_only` and `review_decision_append_only` refuse every UPDATE and DELETE, and `research_finding_append_only` refuses every DELETE and any UPDATE that changes more than `findingStatus`, `verifiedByHuman`, `verifiedBy` and `verifiedAt`. Each raises `<table> is append-only`, so a bug in an action, or a stray statement, fails instead of rewriting history.
- Nothing guards a `DriftEvent`, a `ProposedRule` or a `HardScreenConfig`: actions update them in place, so what they may change is application code only. The `Firm` row is current state.
- The triggers are not a permission. The Worker connects with one connection string that has full rights, as the owner of the tables, and an owner can drop a trigger or TRUNCATE. TRUNCATE fires no row trigger, which the nightly reset relies on (it truncates and restores the history), so the trail covers one demo day. The seed's timestamp shift, which used to UPDATE history in place, now rewrites those tables through a copy and a TRUNCATE for the same reason.
- The wording matters: the app and docs say "scores and decisions" are insert-only, not that all history is (a test guards the About page against a blanket claim).
- A production system would add a database role that owns nothing and has no UPDATE, DELETE or TRUNCATE on the history, and would stop truncating. [security.md](../security.md#audit-trail) and the [production roadmap](../production-roadmap.md) say the same.

## Code

`server/db/migrations/0003_integrity.sql`, `server/db/history.ts`, `server/db/integrity.test.ts`, `server/actions/common.ts`, `findings.ts`, `drift.ts`, `rules.ts`, `server/actions/registry.ts`, `api/`. See [security.md](../security.md#audit-trail).
