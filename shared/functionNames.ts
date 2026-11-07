/**
 * The query functions the server runs (server/functions/) and the client calls (src/data/adapter.ts).
 * Both sides are typed against this list, so renaming a function on one side fails to compile until
 * the other follows.
 */
export type FunctionName =
  | "homeSummary"
  | "accuracySummary"
  | "operationsSummary"
  | "shellCounts"
  | "firmObservations"
  | "sourceDocument";
