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
  /**
   * The recorded extraction run: values the model returned for the firms, and how many passed the
   * grounding check (their quote is in the record and states the value).
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
  /** Share of firms whose tier from the agent's evidence equals the tier from the truth. */
  tierAgreement: number | null;
  ruleRecovery: { planted: number; recovered: number; method: "heuristic" };
  /** Minimum each measured figure must reach, keyed by its path in this report. */
  thresholds: Record<string, number>;
  passed: boolean;
}
