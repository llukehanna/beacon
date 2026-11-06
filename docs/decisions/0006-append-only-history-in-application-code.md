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

- Nothing in the database enforces this. There are no triggers or revoked privileges, and the Worker connects with one connection string that has full rights. A bug in an action, or anyone with that string, could change history.
- The nightly reset truncates the history, so the trail covers one demo day.
- The wording matters: the app and docs say "scores and decisions" are insert-only, not that all history is (a test guards the About page against a blanket claim).
- A production system would add write-once tables or a database role without UPDATE and DELETE, and would stop truncating. [security.md](../security.md#audit-trail) and the [production roadmap](../production-roadmap.md) say the same.

## Code

`server/actions/common.ts`, `findings.ts`, `drift.ts`, `rules.ts`, `server/actions/registry.ts`, `api/`. See [security.md](../security.md#audit-trail).
