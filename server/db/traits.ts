/**
 * Where a firm's `traits` map comes from and goes to. Firms store each trait value as an
 * append-only `firm_trait_value` row (migration 0005); a firm's traits are its latest revisions.
 * Every reader of firm rows (the repo, and the summaries that select firms with raw SQL) selects
 * them with `traitsSql`, and every writer goes through `appendTraitValues`.
 */
import type { TraitDef, TraitValue } from "../../shared/rubric/types.js";
import { ActionError } from "../errors.js";
import { loadTraits } from "../rubric/load.js";
import type { Queryable } from "./client.js";

/** The value a trait-value row holds, as jsonb (null when the row cleared the trait). */
const VALUE_JSON = `coalesce(to_jsonb(c."valueString"), to_jsonb(c."valueNumber"), to_jsonb(c."valueBoolean"))`;

/**
 * A select-list item, `traits`, holding the current traits of the firm row `alias` as one jsonb
 * object. Traits whose latest value cleared them are left out. `only`, a parameter reference such
 * as `$2` bound to a text array, keeps just those trait keys.
 */
export function traitsSql(alias: string, only?: string): string {
  const which = only === undefined ? "" : ` AND c."traitKey" = ANY(${only})`;
  return (
    `(SELECT coalesce(jsonb_object_agg(c."traitKey", ${VALUE_JSON}) FILTER (WHERE ${VALUE_JSON} IS NOT NULL), '{}'::jsonb)` +
    ` FROM firm_trait_current c WHERE c."firmId" = ${alias}."firmId"${which}) AS traits`
  );
}

/** A selected firm row with its `traits` parsed into a plain map. */
export function withTraits<T extends Record<string, unknown>>(
  row: T,
): T & { traits: Record<string, TraitValue> } {
  const raw = typeof row.traits === "string" ? (JSON.parse(row.traits) as unknown) : row.traits;
  const traits: Record<string, TraitValue> = {};
  if (raw !== null && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
        traits[k] = v;
      }
    }
  }
  return { ...row, traits };
}

/** Who set a batch of trait values, when, and the finding behind each (if any). */
export interface TraitValueStamp {
  setBy: string;
  setAt: string;
  /** The finding behind every value in the batch. */
  sourceFindingId?: string;
  /** The finding behind one trait's value, by trait key; wins over `sourceFindingId`. */
  sources?: Readonly<Record<string, string | undefined>>;
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

/** Check new values against the catalog: every key a trait, every value of its kind or null. */
function checked(
  catalog: ReadonlyMap<string, TraitDef>,
  values: Readonly<Record<string, unknown>>,
): [TraitDef, TraitValue | null][] {
  return Object.entries(values).map(([key, value]) => {
    const trait = catalog.get(key);
    if (!trait) {
      throw new ActionError(`Unknown trait: ${key}`);
    }
    if (value !== null && !fits(trait, value)) {
      throw new ActionError(
        `${key} must be a ${trait.kind === "yesno" ? "yes/no" : trait.kind} value`,
      );
    }
    if (trait.wholeNumber && typeof value === "number" && !Number.isInteger(value)) {
      throw new ActionError(`${key} must be a whole number, got ${value}`);
    }
    return [trait, value as TraitValue | null];
  });
}

/**
 * Record new values for one firm's traits: each becomes the trait's next revision, and null
 * clears the trait. Every key must be a catalog trait and every value of that trait's kind;
 * otherwise nothing is written and the error names the trait.
 */
export async function appendTraitValues(
  q: Queryable,
  firmId: string,
  values: Readonly<Record<string, unknown>>,
  stamp: TraitValueStamp,
): Promise<void> {
  await appendFirmsTraitValues(q, [{ firmId, traits: values }], stamp);
}

/**
 * `appendTraitValues` for many firms in two statements: the seed writes a whole universe this way.
 */
export async function appendFirmsTraitValues(
  q: Queryable,
  firms: readonly { firmId: string; traits: Readonly<Record<string, unknown>> }[],
  stamp: TraitValueStamp,
): Promise<void> {
  if (firms.every((f) => Object.keys(f.traits).length === 0)) {
    return;
  }
  const catalog = new Map((await loadTraits(q)).map((t) => [t.traitKey, t]));
  const rows = firms.flatMap(({ firmId, traits }) =>
    checked(catalog, traits).map(([trait, value]) => ({ firmId, trait, value })),
  );
  const latest = new Map(
    (
      await q.query<{ firmId: string; traitKey: string; revision: number }>(
        `SELECT "firmId", "traitKey", max("revision")::int AS revision FROM firm_trait_value
          WHERE "firmId" = ANY($1) GROUP BY "firmId", "traitKey"`,
        [[...new Set(rows.map((r) => r.firmId))]],
      )
    ).map((r) => [`${r.firmId}\u0000${r.traitKey}`, r.revision]),
  );
  const records = rows.map(({ firmId, trait, value }) => {
    const revision = (latest.get(`${firmId}\u0000${trait.traitKey}`) ?? 0) + 1;
    return {
      traitValueId: `${firmId}:${trait.traitKey}:${revision}`,
      firmId,
      traitKey: trait.traitKey,
      revision,
      valueString: null,
      valueNumber: null,
      valueBoolean: null,
      [VALUE_COLUMN[trait.kind]]: value,
      sourceFindingId: stamp.sources?.[trait.traitKey] ?? stamp.sourceFindingId ?? null,
      setBy: stamp.setBy,
      setAt: stamp.setAt,
    };
  });
  await q.query(
    `INSERT INTO firm_trait_value SELECT * FROM json_populate_recordset(NULL::firm_trait_value, $1::json)`,
    [JSON.stringify(records)],
  );
}
