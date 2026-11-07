/**
 * The tables whose rows only ever grow, and what each may still change. Migration 0003 puts a
 * trigger on each (`<table>_append_only`) that refuses the rest; `integrity.test.ts` checks the
 * triggers in the database against this list.
 */
export const APPEND_ONLY_TABLES = [
  "qualification_score",
  "review_decision",
  "research_finding",
] as const;

export type AppendOnlyTable = (typeof APPEND_ONLY_TABLES)[number];

/** The columns an UPDATE may change on an append-only table; the others accept none. */
export const MUTABLE_COLUMNS: Readonly<Record<AppendOnlyTable, readonly string[]>> = {
  qualification_score: [],
  review_decision: [],
  research_finding: ["findingStatus", "verifiedByHuman", "verifiedBy", "verifiedAt"],
};
