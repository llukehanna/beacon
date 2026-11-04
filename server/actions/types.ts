import type { ObjectTypeName } from "../../shared/schema.js";
import type { Clusterer } from "../clustering/types.js";
import type { Queryable } from "../db/client.js";

export type ParamType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "timestamp"
  | "string[]"
  | { object: ObjectTypeName };

export interface ParamDef {
  type: ParamType;
  nullable?: boolean;
}

export interface ActionContext {
  tx: Queryable;
  now: Date;
  user: string;
  newId(prefix: string): string;
  /** Injected by tests and the seed; otherwise chosen by applyAction for actions with needsClusterer. */
  clusterer?: Clusterer;
}

export interface ActionResult {
  created?: string[];
  modified?: string[];
  /** Object types the action wrote to (filled in by applyAction), so clients can refresh just those. */
  types?: ObjectTypeName[];
  /** Human-readable context for the UI (e.g. which clusterer proposed rules). */
  note?: string;
}

export interface ActionDef<P, Prep = undefined> {
  params: { [K in keyof P]-?: ParamDef };
  /**
   * Slow or network work (a Claude call) that must not hold a database
   * transaction open. applyAction runs it on the root connection before the
   * transaction opens and hands its result to run as `prep`. It may read, but
   * anything it saw can be stale by the time run executes, so run re-checks
   * whatever it relies on.
   */
  prepare?(db: Queryable, params: P, ctx: Omit<ActionContext, "tx">): Promise<Prep>;
  run(ctx: ActionContext, params: P, prep: Prep): Promise<ActionResult>;
  /**
   * The action clusters rejections. applyAction chooses the clusterer on the
   * root connection before the transaction opens, so the Claude cost-guard
   * claim commits on its own and survives a rollback of the action.
   */
  needsClusterer?: boolean;
}

export function defineAction<P, Prep = undefined>(def: ActionDef<P, Prep>): ActionDef<P, Prep> {
  return def;
}
