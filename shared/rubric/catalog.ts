/** Reading a trait catalog: which traits the agent researches, for whom, and with what vocabulary. */
import { resolveThesis } from "./engine.js";
import type { RubricDefinition, TraitDef } from "./types.js";

/** What the agent paths need to know about a researched trait. */
export type EvidenceTrait = Pick<TraitDef, "traitKey" | "kind">;

/** The traits providers observe and analysts verify, in catalog order. */
export function evidenceTraits(traits: readonly TraitDef[]): TraitDef[] {
  return traits.filter((t) => t.role === "evidence");
}

/** The catalog entry for a key (trimmed, case-insensitive), if any. */
export function traitFor(traits: readonly TraitDef[], key: string): TraitDef | undefined {
  const k = key.trim().toLowerCase();
  return traits.find((t) => t.traitKey === k);
}

/** Whether firms of this thesis are researched for the trait. */
export function researchedFor(
  def: RubricDefinition,
  trait: TraitDef,
  thesisKey: string | null | undefined,
): boolean {
  return trait.theses === null || trait.theses.includes(resolveThesis(def, thesisKey).key);
}

/** The labels a category trait takes for a thesis: the thesis's scored options, else the catalog's. */
export function optionsFor(
  def: RubricDefinition,
  thesisKey: string | null | undefined,
  trait: TraitDef,
): string[] {
  const c = resolveThesis(def, thesisKey).criteria.find((x) => x.traitKey === trait.traitKey);
  return c?.scoring.type === "category"
    ? c.scoring.options.map((o) => o.value)
    : [...(trait.options ?? [])];
}
