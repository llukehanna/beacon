/**
 * Query functions: named, read-only computations the server runs next to the
 * data. They mirror Foundry query functions (the client calls them through
 * useOsdkQuery); a function takes a params object and returns plain JSON.
 */
import type { Queryable } from "../db/client.js";
import { HttpError } from "../errors.js";
import { accuracySummary } from "./accuracySummary.js";
import { homeSummary } from "./homeSummary.js";
import { sourceDocument } from "./sourceDocument.js";

export type QueryFunction = (q: Queryable, params: Record<string, unknown>) => Promise<unknown>;

export const FUNCTIONS: Record<string, QueryFunction> = {
  homeSummary: (q) => homeSummary(q),
  accuracySummary: (q) => accuracySummary(q),
  sourceDocument: (q, params) => sourceDocument(q, params),
};

export async function runFunction(
  q: Queryable,
  name: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
    throw new HttpError(`Unknown function "${name}"`, 404);
  }
  return FUNCTIONS[name](q, params);
}
