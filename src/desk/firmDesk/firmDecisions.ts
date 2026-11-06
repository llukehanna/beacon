/** A firm's own past decisions, as the History tab lists them. Pure. */

interface DecisionRow {
  decisionId?: string;
  decisionType?: string | null;
  rejectionRationale?: string | null;
  scoreAtDecision?: number | null;
  decidedAt?: unknown;
}

export interface FirmDecision {
  id: string;
  at: number;
  /** The decision in words ("Passed", "Qualified"). */
  label: string;
  /** Whether the decision turned the firm down (a pass or a hard reject). */
  rejected: boolean;
  /** Why the firm was passed on, when the analyst said. */
  rationale: string | null;
  /** The score when the decision was made, when it was recorded. */
  score: number | null;
}

const KNOWN: Record<string, string> = {
  reject: "Passed",
  hard_reject: "Hard-rejected",
  keep_passed: "Kept passed",
  advance: "Advanced",
  qualify: "Qualified",
  outreach: "Outreach",
  accept: "Accepted",
  enrich: "Enriched",
  re_engage: "Re-engaged",
};

const toMs = (raw: unknown): number =>
  raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();

/** "some_new_type" becomes "Some new type" when the vocabulary above has no word for it. */
function wordsFor(type: string): string {
  const spaced = type.replace(/[_-]+/g, " ").trim();
  return spaced === "" ? "Decision" : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Newest first; a decision with no readable time is dropped, since it cannot be placed in the list. */
export function firmDecisions(rows: readonly DecisionRow[]): FirmDecision[] {
  return rows
    .map((r) => {
      const type = (r.decisionType ?? "").trim().toLowerCase();
      const rationale = (r.rejectionRationale ?? "").trim();
      return {
        id: r.decisionId ?? "",
        at: toMs(r.decidedAt),
        label: KNOWN[type] ?? wordsFor(type),
        rejected: type.includes("reject"),
        rationale: rationale === "" ? null : rationale,
        score: typeof r.scoreAtDecision === "number" ? r.scoreAtDecision : null,
      };
    })
    .filter((d) => !Number.isNaN(d.at))
    .sort((a, b) => b.at - a.at);
}
