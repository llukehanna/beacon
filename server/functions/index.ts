/**
 * Query functions: named, read-only computations the server runs next to the
 * data. They mirror Foundry query functions (the client calls them through
 * useOsdkQuery); a function takes a params object and returns plain JSON.
 */
import { type Access, NO_WALL } from "../access.js";
import type { Queryable } from "../db/client.js";
import { HttpError } from "../errors.js";
import { accuracySummary } from "./accuracySummary.js";
import { firmObservations } from "./firmObservations.js";
import { homeSummary } from "./homeSummary.js";
import { operationsSummary } from "./operationsSummary.js";
import { shellCounts } from "./shellCounts.js";
import { sourceDocument } from "./sourceDocument.js";

/** A function runs for one persona: `access` says which firms it must leave out and which mandates it must name by codename. */
export type QueryFunction = (
  q: Queryable,
  params: Record<string, unknown>,
  access: Access,
) => Promise<unknown>;

export const FUNCTIONS: Record<string, QueryFunction> = {
  homeSummary: (q, _params, access) => homeSummary(q, access),
  accuracySummary: (q, _params, access) => accuracySummary(q, access),
  sourceDocument: (q, params, access) => sourceDocument(q, params, access),
  firmObservations: (q, params, access) => firmObservations(q, params, access),
  shellCounts: (q, _params, access) => shellCounts(q, access),
  // Measurements of the app itself (action latency, model spend): no firm appears in them.
  operationsSummary: (q) => operationsSummary(q),
};

export async function runFunction(
  q: Queryable,
  name: string,
  params: Record<string, unknown> = {},
  access: Access = NO_WALL,
): Promise<unknown> {
  if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
    throw new HttpError(`Unknown function "${name}"`, 404);
  }
  return FUNCTIONS[name](q, params, access);
}
