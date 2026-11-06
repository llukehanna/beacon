import { OPEN_BUCKETS } from "../../shared/pipelineBuckets";
import { PASSED } from "../../shared/vocab";

export interface CoverageParts {
  total: number;
  /** Firms still waiting on a first decision (the funnel's open buckets). */
  open: number;
  /** Firms past that point and not passed: qualified or later. */
  inProgress: number;
  passed: number;
}

/** Splits the funnel counts into parts that add up to the total, so the card never undercounts. */
export function coverageParts(funnel: Readonly<Record<string, number>>): CoverageParts {
  const total = Object.values(funnel).reduce((a, b) => a + b, 0);
  const open = OPEN_BUCKETS.reduce((sum, bucket) => sum + (funnel[bucket] ?? 0), 0);
  const passed = funnel[PASSED] ?? 0;
  return { total, open, inProgress: total - open - passed, passed };
}
