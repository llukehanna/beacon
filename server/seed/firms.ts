/** Writing generated firms: the firm rows, then their trait values. */
import type { Props } from "../../shared/schema.js";
import type { Queryable } from "../db/client.js";
import { insertObjects } from "../db/repo.js";
import { type TraitValueStamp, appendFirmsTraitValues } from "../db/traits.js";

/** A firm record to create, with the trait values to store for it. */
export type NewFirm = Props<"Firm"> & {
  firmId: string;
  traits?: Readonly<Record<string, unknown>>;
};

/** Insert firms and record each one's traits as revision 1, in two statements. */
export async function insertFirms(
  q: Queryable,
  firms: readonly NewFirm[],
  stamp: TraitValueStamp,
): Promise<void> {
  await insertObjects(
    q,
    "Firm",
    firms.map(({ traits: _traits, ...row }) => row),
  );
  await appendFirmsTraitValues(
    q,
    firms.map((f) => ({ firmId: f.firmId, traits: f.traits ?? {} })),
    stamp,
  );
}
