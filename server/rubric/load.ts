import { parseRubricDefinition } from "../../shared/rubric/definition.js";
import type { RubricDefinition, TraitDef } from "../../shared/rubric/types.js";
import type { Queryable } from "../db/client.js";

export interface ActiveRubric {
  rubricId: string;
  definition: RubricDefinition;
}

// A published version never changes, so a parsed definition is cached by id for the isolate's life.
const parsed = new Map<string, RubricDefinition>();

/** The one active rubric. Stage 1 has a single workspace, so exactly one row is active. */
export async function loadActiveRubric(q: Queryable): Promise<ActiveRubric> {
  const rows = await q.query<{ rubricId: string; definitionJson: string }>(
    `SELECT "rubricId", "definitionJson" FROM rubric WHERE "active"`,
  );
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one active rubric, found ${rows.length}`);
  }
  const { rubricId, definitionJson } = rows[0];
  let definition = parsed.get(rubricId);
  if (definition === undefined) {
    definition = parseRubricDefinition(JSON.parse(definitionJson));
    parsed.set(rubricId, definition);
  }
  return { rubricId, definition };
}

interface TraitRow {
  traitKey: string;
  label: string;
  description: string | null;
  unit: string | null;
  kind: TraitDef["kind"];
  role: TraitDef["role"];
  optionsJson: string | null;
  passWhen: boolean | null;
  thesesJson: string | null;
}

/** The trait catalog, in catalog order. */
export async function loadTraits(q: Queryable): Promise<TraitDef[]> {
  const rows = await q.query<TraitRow>(
    `SELECT "traitKey", "label", "description", "unit", "kind", "role", "optionsJson", "passWhen",
            "thesesJson"
       FROM trait ORDER BY "position"`,
  );
  return rows.map((r) => ({
    traitKey: r.traitKey,
    label: r.label,
    description: r.description ?? "",
    unit: r.unit,
    kind: r.kind,
    role: r.role,
    options: r.optionsJson === null ? null : (JSON.parse(r.optionsJson) as string[]),
    passWhen: r.passWhen,
    theses: r.thesesJson === null ? null : (JSON.parse(r.thesesJson) as string[]),
  }));
}
