# 0011. Traits and the rubric are data

Status: Accepted

## Context

Beacon was built around one team's thesis: nine named axes, two business models and an 18-point rubric written as code (`shared/scoreMirror.ts`). Every screen, export and agent path named those fields, so adapting Beacon to another team, discipline or market meant editing code in dozens of places. The scoring itself was already shared between the browser and the server ([0003](0003-shared-rubric-module.md)); what it scored was not configurable.

## Decision

What can be known about a firm, and how it is scored, are versioned data read by one generic engine.

- **The trait catalog** (`Trait` objects) lists every trait a workspace tracks: its key, label, unit, kind (`category`, `number` or `yesno`), role and vocabulary, and for a number whether it counts whole things (`wholeNumber`, so a fraction is refused). Its role is one of:
  - `evidence`: providers observe it, analysts verify it, and the rubric may score it.
  - `fact`: set when the firm is generated or discovered; the rubric may score it.
  - `profile`: describes the firm for reading and filtering; it is never scored ([0010](0010-profile-fields-not-axes.md)).
    A yes/no trait carries its gate polarity (`passWhen`).
- **The rubric** (`Rubric` objects, append-only, one active) is a JSON definition validated by `shared/rubric/definition.ts`. It holds one or more theses, each with weighted criteria (category options, numeric bands or a direct score), hard rejects, tier cuts, actions with upgrades, and the product groups that select it. It also holds the candidate screens the rule heuristic may propose.
- **One engine** (`shared/rubric/engine.ts`, `scoreTraits`) scores any definition. The browser and the server load the same active rubric and catalog, so the preview and the record still cannot disagree.
- **Every firm carries a `traits` map.** Screens, exports, lookalikes, the MCP tools and the agent paths read traits by key and take their labels, options, units and gate polarity from the catalog. A score stamps the rubric id it came from.
- **The advisory-acquisitions workspace** (`shared/workspaces/advisoryAcquisitions.ts`) is the first configured workspace. Its rubric reproduces rubric v2 exactly; a parity test checks it against a frozen copy of the old module on every input the catalog allows. Its vocabulary may appear only in the workspace, the seed and mock agent paths, the offline tooling and tests, and `shared/rubric/leak.test.ts` fails when it leaks anywhere else.

The change ships in two phases. In phase A the catalog and rubric became tables and the `traits` map was derived from the firm's columns in one place (`server/db/traits.ts`). In phase B (migration 0005) each value is an append-only `firm_trait_value` row: revision 1, 2, ... per firm and trait, with who set it, when, and the finding behind it. A firm's `traits` are its latest revisions (`firm_trait_current`), and every writer appends through `appendTraitValues`. The firm's thesis moved from `firmType` to `thesis`. Migration 0006 then dropped the seventeen trait columns and `firmType`, from the firm table and the reset snapshot, after checking that every value it dropped was already a trait value or a thesis. The whole-number check, which had read the old integer column types, moved into the catalog as `wholeNumber`.

## Consequences

- A second team can be configured as a new catalog and rubric definition, without code changes to the engine, the desk or the exports. A test runs the desk, queue, export and lookalike models under an unrelated toy rubric to keep it that way.
- Changing the rubric is a new rubric version. It is still a migration and a deploy until a later stage adds an editor. Stored scores keep the id of the rubric that produced them.
- A category value outside the thesis's options scores as unknown. The old module matched coverage spellings by substring; the catalog's labels are the only values the app writes.
- A few layouts are still keyed by this workspace's trait keys: the export's profile columns, the lookalike weights and two pipeline columns. In another workspace they show empty values until stage 2 moves them into workspace configuration.

## Code

`shared/rubric/` (types, definition, engine, catalog, trait values, leak test), `shared/workspaces/`, `server/db/migrations/0004_trait_catalog.sql`, `server/db/migrations/0005_firm_trait_value.sql`, `server/db/migrations/0006_drop_trait_columns.sql`, `server/db/traits.ts`, `server/rubric/load.ts`, `src/data/rubric.ts`, `src/data/RubricProvider.tsx`. See [architecture.md](../architecture.md#scoring-as-shared-code).
