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

export interface RubricLoad {
  /** The active rubric and catalog: the last one loaded, kept while a refetch is in flight. */
  rubric: ActiveRubric | undefined;
  /** Why it could not be loaded, when nothing has loaded yet. */
  error: Error | undefined;
  retry: () => void;
}

/**
 * The active rubric and its trait catalog. The rubric is the same for every persona, so the last
 * one loaded is kept while a persona switch refetches it: nothing under it remounts.
 */
export function useActiveRubric(): RubricLoad {
  const rubrics = useOsdkObjects(Rubric, {
    where: { active: { $eq: true } },
    staleTime: Infinity,
  });
  const traits = useOsdkObjects(Trait, { autoFetchMore: true, staleTime: Infinity });
  const row = rubrics.data?.[0];
  const traitRows = traits.data;
  const loaded = React.useMemo((): ActiveRubric | undefined => {
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
        theses: t.thesesJson === undefined ? null : (JSON.parse(t.thesesJson) as string[]),
      }));
    return { rubricId: row.rubricId, definition, traits: catalog };
  }, [row, traitRows]);
  // Kept for the provider's lifetime: a refetch (a persona switch) never blanks what is shown.
  const [last, setLast] = React.useState<ActiveRubric | undefined>(undefined);
  if (loaded !== undefined && loaded !== last) {
    setLast(loaded);
  }
  const noneActive = rubrics.data !== undefined && rubrics.data.length === 0;
  const error =
    rubrics.error ?? traits.error ?? (noneActive ? new Error("No rubric is active.") : undefined);
  const { refetch: retryRubrics } = rubrics;
  const { refetch: retryTraits } = traits;
  const retry = React.useCallback(() => {
    void retryRubrics();
    void retryTraits();
  }, [retryRubrics, retryTraits]);
  const rubric = loaded ?? last;
  return { rubric, error: rubric === undefined ? error : undefined, retry };
}
