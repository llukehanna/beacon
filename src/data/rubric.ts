import React from "react";
import { parseRubricDefinition } from "../../shared/rubric/definition";
import type { RubricContext, TraitDef } from "../../shared/rubric/types";
import { useOsdkObjects } from "./hooks";
import { Rubric, Trait } from "./ontology";

export interface ActiveRubric extends RubricContext {
  rubricId: string;
}

// A published rubric version never changes, so its parsed definition is kept by id.
const parsed = new Map<string, RubricContext["definition"]>();

/** The active rubric and its trait catalog; undefined until both have loaded. */
export function useActiveRubric(): ActiveRubric | undefined {
  const rubrics = useOsdkObjects(Rubric, {
    where: { active: { $eq: true } },
    staleTime: Infinity,
  });
  const traits = useOsdkObjects(Trait, { autoFetchMore: true, staleTime: Infinity });
  const row = rubrics.data?.[0];
  const traitRows = traits.data;
  return React.useMemo(() => {
    if (row === undefined || traitRows === undefined) {
      return undefined;
    }
    let definition = parsed.get(row.rubricId);
    if (definition === undefined) {
      definition = parseRubricDefinition(JSON.parse(row.definitionJson));
      parsed.set(row.rubricId, definition);
    }
    const catalog: TraitDef[] = [...traitRows]
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        traitKey: t.traitKey,
        label: t.label,
        description: t.description ?? "",
        unit: t.unit ?? null,
        kind: t.kind as TraitDef["kind"],
        role: t.role as TraitDef["role"],
        options: t.optionsJson === undefined ? null : (JSON.parse(t.optionsJson) as string[]),
        passWhen: t.passWhen ?? null,
      }));
    return { rubricId: row.rubricId, definition, traits: catalog };
  }, [row, traitRows]);
}
