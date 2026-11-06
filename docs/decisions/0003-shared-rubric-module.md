# 0003. One rubric module for the browser and the server

Status: Accepted

## Context

The desk previews a firm's score while an analyst accepts findings, and the server writes the score into history. If those are two implementations they can disagree, and the preview then promises a tier the record does not give. The Foundry version kept the rubric in a Function and mirrored it in client code, with a parity test to catch drift.

## Decision

The rubric is one pure module, `shared/scoreMirror.ts` (nine axes scored 0 to 2, 18 points, separate tables for the corporate-finance and capital-solutions theses, hard rejects and A/B/C tiers), imported by both sides. `shared/scoring.ts` wraps it as `scoreFirm` and carries the version stamps. The server's `snapshotScore` and the desk's score preview both call it.

## Consequences

- There is no second implementation, so no parity test is needed. The rubric's own tests are in `shared/scoring.test.ts`.
- Every `QualificationScore` records `rubricVersion` and `thesisVersion`, so a stored score says which rules produced it.
- The rubric ships in the browser bundle. That is acceptable here because it is a published, deterministic rule set, not a secret.
- Changing the rubric is a code change and a deploy. A deployment where analysts edit the rubric would need it moved behind data or an admin action, and the preview would then need that data too.
- The module keeps its original name, `scoreMirror`, although it is now the only copy.

## Code

`shared/scoreMirror.ts`, `shared/scoring.ts`, `server/actions/common.ts` (`snapshotScore`), `src/desk/scoreFormat.ts`. See [architecture.md](../architecture.md#scoring-as-shared-code).
