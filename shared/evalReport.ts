/**
 * Why an axis of a firm ended without the true value recorded. Every such axis is in exactly one.
 * - wrong-source-wins: the agent settled on a value that is not the truth, because no other
 *   source disagreed with the wrong one.
 * - conflict-surfaced: two sources disagreed, so the agent recorded both positions and left the
 *   choice to the analyst.
 * - abstained-correctly: no source's record stated the axis, so the agent recorded no value.
 * - abstained-wrongly: a record stated the axis, but no value survived extraction and grounding.
 */
export type FailureKind =
  "wrong-source-wins" | "conflict-surfaced" | "abstained-correctly" | "abstained-wrongly";

/** What each kind of failure means, in the words the report uses. */
export const FAILURE_TEXT: Readonly<Record<FailureKind, { label: string; meaning: string }>> = {
  "wrong-source-wins": {
    label: "A wrong value was settled",
    meaning:
      "The agent settled on a value that is not the truth, because no other source disagreed with the wrong one",
  },
  "conflict-surfaced": {
    label: "Sources disagreed",
    meaning: "The agent recorded both positions and left the choice to the analyst",
  },
  "abstained-correctly": {
    label: "No source had it",
    meaning: "No source's record stated the axis, so the agent recorded no value",
  },
  "abstained-wrongly": {
    label: "A value was lost",
    meaning: "A record stated the axis but no value survived extraction and grounding",
  },
};

/**
 * The shape of `docs/evals.json`, written by `npm run eval` and read by the Accuracy page.
 * Every figure is measured against the synthetic universe's hidden ground truth.
 * Rates are 0 to 1, or null when there was nothing to measure.
 */
export interface EvalReport {
  version: 1;
  generatedFrom: {
    /** DOCUMENT_VERSION: the source-record templates the agent read. */
    documents: string;
    /** EXTRACTION_PROMPT_VERSION. */
    prompt: string;
    /** The recorded extraction model(s) the agent read, or "rule-based". */
    fixtures: string;
  };
  firms: number;
  /** Every axis of every firm the agent enriches, and how many ended with the true value settled. */
  slots: { total: number; correct: number };
  /**
   * The recorded extraction run: values the model returned for the firms, and how many passed the
   * grounding check (their quote is in the record and contains the value).
   */
  recordedRun: { values: number; grounded: number };
  /** Field-level, per provider: its grounded readings against the hidden truth. */
  providers: { provider: string; coverage: number | null; precision: number | null }[];
  reconciled: {
    coverage: number | null;
    precision: number | null;
    conflictRate: number | null;
    higherTrustRight: number | null;
  };
  abstention: { rate: number | null; calibration: number | null };
  /**
   * The axes that did not end correct, by kind: `count`s sum to `slots.total - slots.correct`.
   * Up to three examples each, the first in firm order and each from a different firm. All kinds are always listed.
   */
  failures: { kind: FailureKind; count: number; examples: { firmId: string; axis: string }[] }[];
  /** Share of firms whose tier from the agent's evidence equals the tier from the truth. */
  tierAgreement: number | null;
  ruleRecovery: { planted: number; recovered: number; method: "heuristic" };
  /** Minimum each measured figure must reach, keyed by its path in this report. */
  thresholds: Record<string, number>;
  passed: boolean;
}
