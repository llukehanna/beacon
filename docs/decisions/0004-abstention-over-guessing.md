# 0004. Abstain or surface a conflict instead of guessing

Status: Accepted

## Context

For a given firm and axis the sources may say nothing, agree, or disagree. A system that always returns a value hides the cases where an analyst's judgment is the only thing that can settle it, and it makes the score look more certain than the evidence is.

## Decision

Reconciliation turns the grounded observations for one axis into findings by three rules (`server/enrichment/reconcile.ts`):

- **No observations: abstain.** A finding with no value, saying no source supported one. An answer that was dropped by the grounding check gets its own excerpt saying so.
- **Agreement: one corroborated finding**, credited to every agreeing provider.
- **Disagreement: a conflict.** The two most trusted positions (BeaconDB, Deal DB, Filings, Web search, in that order) are shown as a pair. The agent never picks a winner; the analyst resolves it and the other finding is marked rejected.

An unverified finding never counts as verified: `verifiedByHuman` is set only by an analyst action.

## Consequences

- The Accuracy page reports the abstention rate and the evaluation scores it against the generated truth (abstention rate and calibration), so abstention is measured rather than assumed to be good.
- Some axes stay empty until a person fills them, and the firm's score reflects that (an unknown axis scores 0 and lowers the confidence figure).
- A conflict costs analyst time. The evaluation also reports how often the more trusted source of a conflict is the right one, which is the figure to look at before ever letting the agent choose.

## Code

`server/enrichment/reconcile.ts`, `server/actions/findings.ts` (`resolveConflict`, `verifyFinding`), `server/eval/` for the measurements. See [evals.md](../evals.md).
