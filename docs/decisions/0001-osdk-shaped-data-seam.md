# 0001. An OSDK-shaped data seam

Status: Accepted

## Context

The screens were first written against Foundry's OSDK: typed object hooks, an action hook, link traversal and query functions. When the backend moved to Postgres and Cloudflare Workers, the choice was between rewriting every screen against a new data layer and keeping the screens as they were and putting the new backend behind the same hooks.

## Decision

All data access goes through `src/data/`, which keeps the OSDK hook names and return fields. Screens import hooks and object or action tokens from there and never call `fetch` themselves.

- `useOsdkObjects` pages through `GET /api/objects`, `useOsdkQuery` calls a named query function, `useOsdkAction` posts to `/api/actions`, and `useLinks` follows a link.
- `src/data/ontology.ts` exports one token per object type and per action, typed from `shared/schema.ts`.
- A successful action refreshes only the object types it wrote, the links that touch them and the function results (`invalidateAfterAction`).

## Consequences

- The port changed the screens' data code mostly in its import lines.
- Only `src/data/api.ts` knows the transport. Pointing the same screens at a different backend means replacing that file and `hooks.ts`.
- The seam is a convention plus types, not a generated client: a new object type or action needs a token added by hand to `src/data/ontology.ts`.
- Hook names follow the OSDK, so a reader who knows the OSDK can read the screens, and the query keys and refresh rule are this repository's own.

## Code

`src/data/hooks.ts`, `src/data/ontology.ts`, `src/data/api.ts`, `src/data/wire.ts`. See [architecture.md](../architecture.md#ontology-first).
