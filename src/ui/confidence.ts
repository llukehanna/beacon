export type ConfidenceLevel = "high" | "low" | null;

export const CONFIDENCE_BAR_TOTAL = 3;

/** How many of the three confidence bars are lit: high is all three, low is one, unknown is none. */
export function confidenceBarCount(level: ConfidenceLevel): number {
  if (level === "high") {
    return CONFIDENCE_BAR_TOTAL;
  }
  if (level === "low") {
    return 1;
  }
  return 0;
}
