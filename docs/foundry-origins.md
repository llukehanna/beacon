# From Foundry to an open stack: a port case study

Beacon was first built on Palantir Foundry. When that environment went away, the backend was rebuilt on an open stack (Postgres, TypeScript, Cloudflare Workers) behind the same React frontend. The screens and their pure modules were kept. Everything under them was replaced.

This page maps each Foundry concept to what it became here, what was lost or gained in the move, and why. The decisions that shaped the port are written up one by one in [decisions/](decisions/README.md), and the data model is in the generated [ontology reference](ontology.md).

| Foundry (original)                                    | This repo                                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ontology: 12 object types, 12 link types              | `shared/schema.ts`: 15 object types (11 carried over, 1 not ported, 4 added; see below), 2 traversed links; Postgres tables generated from it |
| Pipeline Builder cleaning a licensed data export      | `server/seed/universe.ts`: deterministic synthetic universe                                                                                                                 |
| 30 Actions (function-backed + declarative)            | 18 actions in `server/actions/` (every one the UI or seed calls)                                                                                                            |
| 39 TypeScript v1 Functions                            | Query functions in `server/functions/` plus pure modules in `shared/` and `server/`                                                                                         |
| Functions-backed rubric + client mirror + parity test | A redesigned public rubric (v2) in one module imported by both sides (no parity test needed)                                                                                |
| AIP Logic for rejection clustering                    | Claude (`claude-opus-5`, structured output) behind a flag, with a grounding check and a deterministic fallback; plus offline Claude extraction under a grounding contract    |
| OSDK + `@osdk/react` hooks                            | `src/data/hooks.ts`: same hook names over TanStack Query                                                                                                                    |
| Application screens                                   | React screens over those hooks, later rebuilt on a design-token system                                                                                                      |
| OAuth + organization marking on every action          | Open demo: single shared analyst, nightly reset, throttles and row ceilings                                                                                                 |
| Foundry website hosting                               | Cloudflare Workers (static assets + one Worker) with Neon Postgres                                                                                                          |

## Concept by concept

### Ontology becomes one schema file and generated tables

- **Object types: 12 became 15.** The Foundry ontology had 12 object types: `DriftEvent`, `HardScreenConfig`, `LghFirm`, `Mandate`, `ProposedRule`, `QualificationScore`, `ResearchFinding`, `ReviewDecision`, `Search`, `SearchList`, `SearchMembership` and `TargetBrief`. The port carried 11 of them (`LghFirm` became `Firm`) and did not port `TargetBrief`. `Extraction`, `MarketSignal`, `ActionRun` and `ModelCall` were added in this repository, which makes 15.
- **Here.** `shared/schema.ts` declares every object type, its properties and types, the links the screens traverse and the action names. `server/db/ddl.ts` generates one Postgres table per object type from it, `server/db/repo.ts` reads and writes by type and checks every column name against it, and the typed hooks in `src/data/` are keyed by the same names. `npm run ontology:doc` writes [ontology.md](ontology.md) from it, and CI fails if that file is out of date.
- **Kept.** Object types with typed properties and string primary keys, and the idea that the model is declared once and everything else derives from it.
- **Not carried over.** Of the original 12 link types, only the two the screens traverse are declared. Foundry also provides managed object-type editing, permissions on object types and properties, and tools for browsing objects; none of that has an equivalent here.
- **Gained.** The model is a TypeScript file: reviewed in a diff, checked by the compiler, tested, and generated into the database, the API validation, the hooks and the reference document.
- **Why.** A public repository cannot depend on a hosted ontology, and one file is the smallest thing that does the same job for an app this size. See [0001](decisions/0001-osdk-shaped-data-seam.md).

### Pipeline Builder becomes a seeded synthetic universe

- **Here.** The original cleaned a licensed data export into the ontology. This repository has no licensed data: `server/seed/universe.ts` generates 700 invented firms, and four deterministic mock providers observe a hidden true value per axis with their own coverage and error rates.
- **Lost.** Real firms and real sources.
- **Gained.** The right answer is known for every firm and axis, so [the evaluation](evals.md) can score the agent exactly, and every run is reproducible. Every such figure is labelled as measured against synthetic ground truth.
- **Why.** See [0005](decisions/0005-deterministic-providers.md).

### Actions become handlers that run in one transaction

- **Here.** Each action is a definition in `server/actions/` with declared parameters and a `run` function, registered by name. `applyAction` checks the demo's ceilings, validates the parameters against the declaration (object parameters are loaded `FOR UPDATE`, so two actions on one firm run one after the other), runs the handler in a single transaction, reports which object types it wrote so the client refreshes only those, and records an `ActionRun` for the operations metrics.
- **Kept.** Named actions as the only way to write, with typed parameters, and conditions checked before anything is written (a rule must be pending before it can be approved; a pass needs a rationale).
- **Not carried over.** Foundry provides declarative actions, per-action permissions and built-in action logging; here there is no equivalent of the first two, and `ActionRun` records only an action's name, duration and outcome. The preconditions live in handler code, so [ontology.md](ontology.md) lists parameters but not those rules.
- **Gained.** Handlers are plain functions that the seed also calls: the demo's month of history is built through the same actions the UI uses, so the seed doubles as an end-to-end test.
- **Why.** See [0006](decisions/0006-append-only-history-in-application-code.md) for how history is protected and what that does and does not guarantee.

### Functions become query functions and pure modules

- **Here.** Read-only server computations are query functions in `server/functions/` (`homeSummary`, `accuracySummary`, `sourceDocument`, `firmObservations`, `operationsSummary`, `shellCounts`), called through `useOsdkQuery`. Logic that needs no database is kept in pure modules with unit tests: the rubric, predicates, queue ranking and trend arithmetic in `shared/`, and extraction, grounding, reconciliation and the evaluation metrics in `server/`.
- **Kept.** The split between "compute near the data" and "compute anywhere", and the tests that came with the pure modules.
- **Gained.** Pure modules import nothing that touches a database or the network, so they can be lifted into another runtime, a hosted function included, without taking the database along.
- **Why.** The pure/impure line is what keeps a port possible in either direction.

### The Functions-backed rubric becomes one shared module

- **Here.** `shared/scoreMirror.ts` is the rubric (version 2, redesigned for the public demo). The desk imports it for live score previews and the server imports it when it writes a score, so there is nothing to keep in step.
- **Gained.** No parity test, because there is one implementation. Each stored score names the rubric version that produced it.
- **Why.** See [0003](decisions/0003-shared-rubric-module.md).

### AIP Logic becomes offline Claude extraction and a grounding contract

- **Here.** Rejection clustering calls Claude (`claude-opus-5`, structured output) and falls back to a keyword heuristic when Claude is off, throttled or failing; both go through the same grounding check, and a person approves a rule before it screens anything ([0007](decisions/0007-human-approval-before-rules-apply.md)). Added in this repository: Claude reads each firm's source records once, offline, and every value must be backed by a word-for-word quote ([0002](decisions/0002-claude-extraction-grounding-fixtures.md)). Where sources are silent or disagree, the agent abstains or raises a conflict ([0004](decisions/0004-abstention-over-guessing.md)).
- **Not carried over.** Foundry provides hosted authoring and running of AIP Logic functions; here the prompt and its checks are code in this repository.
- **Gained.** The prompt, the output schema and the grounding check are code with tests. Model answers are committed as fixtures with their tokens and cost, so the demo, CI and the evaluation need no API key and give the same answer every time.
- **Why.** A public demo should not pay for, or vary with, each visitor's click.

### OSDK becomes the `src/data` seam

- **Here.** `src/data/hooks.ts` keeps the OSDK hook names (`useOsdkObjects`, `useOsdkQuery`, `useOsdkAction`, `useLinks`) with the same return fields, backed by TanStack Query and `/api/*`. `src/data/ontology.ts` exports a token per object type and action. Screens import only these.
- **Kept.** The screens' data code, changed mostly in its import lines.
- **Lost.** A client generated from the ontology: new types and actions need a token added by hand.
- **Why.** The seam is what made the backend swap cheap, and it keeps a return path to Foundry short. See [0001](decisions/0001-osdk-shaped-data-seam.md).

### Application screens stay React screens

- **Here.** The original frontend was already a custom React app on the OSDK, not a configured app-builder module, so there was no layout to translate. The screens, with their pure modules (queue ranking, axis state, active screening, trust metrics, finding actions) and tests, were ported as they were. A later change rebuilt them on a design-token system with Geist fonts and added an end-to-end suite, without changing their hooks.

### Markings and sign-in become a single shared analyst and a list of limits

- **Exists.** One analyst name stamped on every decision (`demo-analyst`); a same-origin check on writes; per-IP rate limits on the two write endpoints; parameter bounds; ceilings on mandates, searches and activity rows; a content security policy; a nightly reset; scores and decisions that are only ever inserted, enforced in application code. [security.md](security.md) states each claim with the file it comes from.
- **Does not exist.** Sign-in, accounts, roles, per-user permissions, organization markings, tenant isolation, and database-enforced immutability of history.
- **Why.** A public demo has one shared analyst and no real data. The [production roadmap](production-roadmap.md) lists what a deployment with real data would need.

### Foundry hosting becomes Workers and Neon

- **Here.** The Vite build is served as static assets and `/api/*` runs in one Worker over Neon Postgres. A saved snapshot restores the demo every night. A Hyperdrive binding is written down but not enabled.
- **Why.** See [0008](decisions/0008-workers-and-snapshot-reset.md) and [0009](decisions/0009-hyperdrive-connection-pooling.md).

## What carried over unchanged

- Every screen, and the pure frontend modules behind them (queue ranking, axis state, active screening, trust metrics, finding actions) with their tests.
- The shape of the rubric: nine axes scored 0, 1, or 2, A/B/C tiers, and hard rejects.
- The firm lifecycle, history that is not rewritten, conflict and abstention semantics, drift, and rule governance with versioned hard-screen configs.

## What changed

- **The rubric.** Version 2 has new labels, cutoffs, tiers, defaults, and hard rejects, designed for the public demo.
- **The data.** A synthetic 700-firm universe with invented names. Enrichment providers are deterministic mocks with neutral names that cite `.example` URLs.
- **The taxonomy.** Generic geographies, products, and sectors.
- **Evidence.** Values come with the quote that supports them, and an answer without one is dropped.
- **Rule clustering.** Claude replaces AIP Logic. A keyword heuristic runs whenever Claude is off, throttled, or unavailable, and both go through the same grounding check.

## Deliberately left out

- Target Brief generation, which was an object type in the original (`TargetBrief`), and the admin data-repair actions (no screen used them).
- Per-user identity and permissions (a public demo has one shared analyst).
- Live third-party data connectors (replaced by deterministic mocks).
