import { randomUUID } from "node:crypto";
import { LINKS, OBJECT_TYPES, type ObjectTypeName, isActionName } from "../../shared/schema.js";
import { USER } from "../../shared/vocab.js";
import { chooseClusterer } from "../clustering/choose.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db, Queryable } from "../db/client.js";
import { ActionError } from "../errors.js";
import { resolveParams } from "./params.js";
import { ACTIONS } from "./registry.js";
import type { ActionResult } from "./types.js";

/** Tables that only grow as people use the demo (append-only history and proposals). */
const ACTIVITY_TABLES = [
  "research_finding",
  "qualification_score",
  "review_decision",
  "drift_event",
  "proposed_rule",
  "hard_screen_config",
];
/** About 10× a fresh seed: room to play, but a script can't bloat every page's fetch before the nightly reset. */
export const MAX_ACTIVITY_ROWS = 10_000;

export interface ApplyOptions {
  now?: Date;
  user?: string;
  newId?: (prefix: string) => string;
  clusterer?: Clusterer;
  /** Tests: override MAX_ACTIVITY_ROWS. */
  maxActivityRows?: number;
}

/** Which object types a write to each table changes: its own, and the source of any link it joins. */
const TYPES_BY_TABLE = new Map<string, ObjectTypeName[]>();
for (const [name, def] of Object.entries(OBJECT_TYPES)) {
  TYPES_BY_TABLE.set(def.table, [name as ObjectTypeName]);
}
for (const link of LINKS) {
  TYPES_BY_TABLE.set(link.joinTable, [
    ...new Set([...(TYPES_BY_TABLE.get(link.joinTable) ?? []), link.source]),
  ]);
}
const WRITE = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-z_]+)"?/i;

/** `tx` that records the object types its INSERT/UPDATE/DELETE statements write to. */
function recordWrites(tx: Queryable, into: Set<ObjectTypeName>): Queryable {
  return {
    query(sql, params) {
      const table = WRITE.exec(sql)?.[1]?.toLowerCase();
      for (const type of (table && TYPES_BY_TABLE.get(table)) || []) {
        into.add(type);
      }
      return tx.query(sql, params);
    },
  };
}

const defaultId = (prefix: string): string => `${prefix}-${randomUUID()}`;

/** Validate and run one named action: `prepare` (if any) first, then `run` inside a single transaction. */
export async function applyAction(
  db: Db,
  name: string,
  raw: unknown,
  opts: ApplyOptions = {},
): Promise<ActionResult> {
  const def = isActionName(name) ? ACTIONS[name] : undefined;
  if (!def) {
    throw new ActionError(`Unknown action "${name}"`, 404);
  }
  const limit = opts.maxActivityRows ?? MAX_ACTIVITY_ROWS;
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT (${ACTIVITY_TABLES.map((t) => `(SELECT count(*) FROM ${t})`).join(" + ")})::int AS n`,
  );
  if (n >= limit) {
    throw new ActionError("The demo has filled up with activity. Reset it to start fresh.", 409);
  }
  const now = opts.now ?? new Date();
  // Outside the transaction: the cost-guard claim must not roll back with the action.
  const clusterer =
    opts.clusterer ?? (def.needsClusterer ? await chooseClusterer(db, now) : undefined);
  const base = {
    now,
    user: opts.user ?? USER,
    newId: opts.newId ?? defaultId,
    clusterer,
  };
  // Outside the transaction too: slow work (the Claude call) must not hold a connection open.
  const prep = def.prepare
    ? await def.prepare(db, await resolveParams(db, def.params, raw), base)
    : undefined;
  const written = new Set<ObjectTypeName>();
  const result = await db.transaction(async (tx) => {
    const params = await resolveParams(tx, def.params, raw);
    return def.run({ ...base, tx: recordWrites(tx, written) }, params, prep);
  });
  return { ...result, types: [...written].sort() };
}
