import type { RubricDefinition, TraitDef } from "../rubric/types.js";

/** One team's configuration: what it knows about a firm and how it scores firms. */
export interface WorkspaceDefinition {
  key: string;
  name: string;
  /** In catalog order: evidence, then facts, then profile fields. */
  traits: TraitDef[];
  rubric: RubricDefinition;
  /** Firm column → trait key while firms still store traits as columns. */
  legacyFields: Readonly<Record<string, string>>;
  /** Every historic field name → trait key, for reading old decision records. */
  legacyFieldAliases: Readonly<Record<string, string>>;
}
