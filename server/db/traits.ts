/**
 * Where a firm's `traits` map comes from. Every reader of firm rows (the repo,
 * and the summaries that select firm columns with raw SQL) goes through here,
 * so moving trait storage changes this one module.
 *
 * Today firms still store traits as columns, so the map is derived from them.
 */
import type { TraitDef, TraitValue } from "../../shared/rubric/types.js";
import { legacyTraits } from "../../shared/rubric/workspace.js";
import { ADVISORY_ACQUISITIONS } from "../../shared/workspaces/advisoryAcquisitions.js";
import { ActionError } from "../errors.js";
import { loadTraits } from "../rubric/load.js";
import type { Queryable } from "./client.js";

export function withTraits<T extends Record<string, unknown>>(
  row: T,
): T & { traits: Record<string, TraitValue> } {
  return { ...row, traits: legacyTraits(ADVISORY_ACQUISITIONS, row) };
}

const COLUMN_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ADVISORY_ACQUISITIONS.legacyFields).map(([column, key]) => [key, column]),
);

/** The firm column a trait is stored in today, or undefined for an unknown trait. */
export function traitColumn(traitKey: string): string | undefined {
  return COLUMN_OF[traitKey];
}

/** Every historic field name (camelCase columns, action params) and trait key, as a trait key. */
export function traitKeyFor(name: string): string | undefined {
  return ADVISORY_ACQUISITIONS.legacyFieldAliases[name] ?? (COLUMN_OF[name] ? name : undefined);
}

/** The firm columns that store traits today: what a raw SELECT needs for `withTraits`. */
export function traitColumns(): string[] {
  return Object.keys(ADVISORY_ACQUISITIONS.legacyFields);
}

/** Who set a batch of trait values, when, and the finding they came from (if any). */
export interface TraitValueStamp {
  setBy: string;
  setAt: string;
  sourceFindingId?: string;
}

const VALUE_COLUMN = {
  category: "valueString",
  number: "valueNumber",
  yesno: "valueBoolean",
} as const satisfies Record<TraitDef["kind"], string>;

function fits(trait: TraitDef, value: unknown): boolean {
  switch (trait.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "yesno":
      return typeof value === "boolean";
    default:
      return typeof value === "string";
  }
}

/**
 * Record new values for a firm's traits: each becomes the trait's next revision. Every key must be
 * a catalog trait and every value of that trait's kind; otherwise nothing is written and the error
 * names the trait.
 */
export async function appendTraitValues(
  q: Queryable,
  firmId: string,
  values: Readonly<Record<string, unknown>>,
  stamp: TraitValueStamp,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return;
  }
  const catalog = new Map((await loadTraits(q)).map((t) => [t.traitKey, t]));
  for (const [key, value] of entries) {
    const trait = catalog.get(key);
    if (!trait) {
      throw new ActionError(`Unknown trait: ${key}`);
    }
    if (!fits(trait, value)) {
      throw new ActionError(
        `${key} must be a ${trait.kind === "yesno" ? "yes/no" : trait.kind} value`,
      );
    }
  }
  const latest = new Map(
    (
      await q.query<{ traitKey: string; revision: number }>(
        `SELECT "traitKey", max("revision")::int AS revision FROM firm_trait_value
          WHERE "firmId" = $1 AND "traitKey" = ANY($2) GROUP BY "traitKey"`,
        [firmId, entries.map(([key]) => key)],
      )
    ).map((r) => [r.traitKey, r.revision]),
  );
  for (const [key, value] of entries) {
    const revision = (latest.get(key) ?? 0) + 1;
    const column = VALUE_COLUMN[catalog.get(key)!.kind];
    await q.query(
      `INSERT INTO firm_trait_value ("traitValueId", "firmId", "traitKey", "revision", "${column}",
                                     "sourceFindingId", "setBy", "setAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        `${firmId}:${key}:${revision}`,
        firmId,
        key,
        revision,
        value,
        stamp.sourceFindingId ?? null,
        stamp.setBy,
        stamp.setAt,
      ],
    );
  }
}
