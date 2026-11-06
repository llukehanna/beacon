# 0010. Profile fields are not axes

Status: Accepted

## Context

A firm has many attributes. Some are evidence the agent gathers and an analyst verifies, and some feed the score. Others describe the firm so an analyst can sort, filter and read it, but are not part of the qualification decision. Treating every attribute the same would make the agent, the rubric and the evaluation larger without improving the decision.

## Decision

`Firm` carries two kinds of property, and the code keeps them apart.

- **Axes** are the properties in `ENRICH_AXES` (`shared/vocab.ts`, 11 of them). Providers observe them, each value becomes a finding with a quote and a verification status, reconciliation can abstain or raise a conflict on them, and each lands in a named `Firm` property. The rubric scores from these and a few other fact fields (headcount, coverage model, geography).
- **Profile fields** are plain `string` properties on `Firm` that describe it: for example `revenueBand`, `ownership` and `successionRisk`, with their vocabularies in `shared/vocab.ts`. They are set when the firm is generated or discovered, shown on the desk and pipeline and available as filters. No provider observes them, no finding is written for them and the rubric does not read them.

A new descriptive attribute is added as a profile field. Promoting it to an axis is a larger change on purpose: an entry in `ENRICH_AXES`, provider coverage, a sentence in the source records, a rubric rule and a new `RUBRIC_VERSION`.

## Consequences

- The agent's evidence trail, the evaluation and the abstention rate describe the axes only. A profile field has no source quote and no verified flag.
- A profile field that later turns out to matter has to be promoted, which means the evaluation can then measure it.
- New descriptive properties stay cheap: a schema entry, a vocabulary and a place to show them. The ontology reference lists each property with its type.

## Code

`shared/schema.ts` (`Firm`), `shared/vocab.ts` (`ENRICH_AXES`, `REVENUE_BANDS`, `OWNERSHIP_TYPES`, `SUCCESSION_RISKS`), `shared/scoreMirror.ts` (the rubric's inputs), `src/desk/firmDesk/FirmHeader.tsx`, `src/pipeline/Filters.tsx`. See [ontology.md](../ontology.md#firm).
