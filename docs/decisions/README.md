# Decision records

The decisions that shape Beacon, each in the same short form: context, decision, consequences and a status, with pointers to the code. A record states what the repository does today, including where something is not built. Superseded decisions would stay here with a note rather than be deleted.

Status is one of **Accepted** (in the code), **Proposed** (written down, not enabled), or **Superseded**.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-osdk-shaped-data-seam.md) | Keep the screens on an OSDK-shaped data seam | Accepted |
| [0002](0002-claude-extraction-grounding-fixtures.md) | Claude extraction with a grounding check, recorded offline as fixtures | Accepted |
| [0003](0003-shared-rubric-module.md) | One rubric module imported by the browser and the server | Accepted |
| [0004](0004-abstention-over-guessing.md) | Abstain or surface a conflict instead of guessing | Accepted |
| [0005](0005-deterministic-providers.md) | Deterministic mock providers with known ground truth | Accepted |
| [0006](0006-append-only-history-in-application-code.md) | History that only grows, enforced by database triggers | Accepted (triggers for scores, decisions and findings; application code for the rest) |
| [0007](0007-human-approval-before-rules-apply.md) | A person approves a rule before it screens anything | Accepted |
| [0008](0008-workers-and-snapshot-reset.md) | Cloudflare Workers and a snapshot-based reset | Accepted |
| [0009](0009-hyperdrive-connection-pooling.md) | Hyperdrive for the Worker's database connection | Proposed (not enabled) |
| [0010](0010-profile-fields-not-axes.md) | Profile fields are not axes | Accepted |

See also [architecture.md](../architecture.md), [security.md](../security.md), [evals.md](../evals.md), the generated [ontology reference](../ontology.md) and the [Foundry port case study](../foundry-origins.md).
