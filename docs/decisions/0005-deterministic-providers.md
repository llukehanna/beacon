# 0005. Deterministic mock providers with known ground truth

Status: Accepted

## Context

The original used licensed data, which cannot be published and cannot be redistributed with a demo. A public repository still needs enrichment that behaves like several imperfect sources, and it needs a way to say how well the agent does. Accuracy can only be measured exactly when the right answer is known.

## Decision

Every synthetic firm has a hidden true value per axis. Four mock providers (BeaconDB, Deal DB, Filings, Web search) observe it, each covering a subset of axes with its own coverage and error rate. An observation is a pure function of `(provider, firmId, axis)`: there is no fixture table, and a firm discovered later still gets data. Each provider's observations are rendered as a source record in that provider's house style, with its errors stated in plain sentences, and the agent reads only those records.

## Consequences

- Runs are reproducible, and the evaluation can score every provider, the reconciled result and abstention against the truth.
- Every figure from that evaluation is a statement about synthetic data. It says nothing about how the agent would do on real firms, and the evaluation page says so.
- Real connectors would replace `server/enrichment/providers.ts` behind the same observation shape; the grounding check, conflict and abstention rules and recorded answers carry over. The mock error rates would be replaced by measured ones (see the [production roadmap](../production-roadmap.md)).
- Source records are labelled "Mock source" in the app.

## Code

`server/enrichment/providers.ts`, `server/extraction/documents.ts`, `server/seed/universe.ts`. See [architecture.md](../architecture.md#the-enrichment-agent) and [evals.md](../evals.md).
