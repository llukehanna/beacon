import type { RubricDefinition, TraitDef } from "../rubric/types.js";

/** One team's configuration: what it knows about a firm and how it scores firms. */
export interface WorkspaceDefinition {
  key: string;
  name: string;
  /** In catalog order: evidence, then facts, then profile fields. */
  traits: TraitDef[];
  rubric: RubricDefinition;
  /**
   * Every historic field name → trait key: the firm columns migration 0006 dropped and the action
   * parameters that named them, for reading old decision records.
   */
  legacyFieldAliases: Readonly<Record<string, string>>;
}
