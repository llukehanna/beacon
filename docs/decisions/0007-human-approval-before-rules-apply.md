# 0007. A person approves a rule before it screens anything

Status: Accepted

## Context

Beacon learns from the reasons analysts pass on firms: pass rationales are grouped into proposed screening rules for the next search. A rule that quietly removes firms from a queue is a decision with consequences, and its input is free text typed by people and read by a model.

## Decision

Proposing and applying are separate steps, and only a person takes the second.

1. **Cluster.** `clusterRejections` gathers every pass decision with its rationale and the firm's facts. Claude proposes predicates on one firm fact at a time (structured output, validated against a schema). When Claude is off, throttled or fails, a keyword heuristic proposes instead.
2. **Ground.** Every proposal, from either source, is checked against the data. A pass counts as support only if its firm satisfies the predicate, and a proposal needs at least four distinct firms. Duplicates of existing rules, including dismissed ones, are dropped.
3. **Project.** Each surviving proposal records how many firms in the current queue it would screen.
4. **Approve.** Nothing screens until an analyst approves. `approveRule` is allowed only on a pending rule and writes a versioned `HardScreenConfig`. Amending the threshold writes a new version, and unapproving or dismissing deactivates the active one. Each step logs a decision.
5. **Screen.** The desk's queue drops firms that trip an active config.

The Claude call is the app's one live model call. It runs only when `CLAUDE_CLUSTERING=on`, at most once per 10 minutes and 24 times per UTC day across all visitors, and both limits are claimed before the action's transaction opens, so a rollback does not refund them. It is made before the transaction and records a `ModelCall` with the token counts and cost.

## Consequences

- The model can propose but not act, and a bad proposal costs one dismissal.
- Rationale text is sent to the model (with decision ids and a few firm facts, not firm names), so the public demo's default is the heuristic, and the documented production setup holds no Anthropic key.
- Approval is a single shared analyst in the demo. A production deployment would want a reviewer role distinct from the proposer.

## Code

`server/actions/rules.ts`, `server/clustering/` (`choose.ts`, `claude.ts`, `heuristic.ts`), `shared/activeScreening.ts`. See [architecture.md](../architecture.md#the-learning-loop) and [security.md](../security.md#model-provider-data-use).
