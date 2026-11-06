// Pure helpers behind the Accuracy page: how a rate cell reads given how many findings stand
// behind it.

/**
 * Cells with fewer samples than this show the count instead of a percentage: one override on a
 * two-finding provider should not read as "Deal DB 100% wrong".
 */
export const MIN_SAMPLE = 5;

export interface RateCell {
  /** What the cell prints: a percentage, "n=3" when the sample is thin, or "—" when there is none. */
  text: string;
  /** True when the sample is too thin for the percentage to mean anything. */
  sparse: boolean;
  /** The percentage to draw as a bar; null when the cell shows no percentage. */
  pct: number | null;
}

export function rateCell(pct: number | null, sample: number): RateCell {
  if (sample === 0) {
    return { text: "—", sparse: false, pct: null };
  }
  if (sample < MIN_SAMPLE) {
    return { text: `n=${sample}`, sparse: true, pct: null };
  }
  if (pct === null) {
    return { text: "—", sparse: false, pct: null };
  }
  return { text: `${pct}%`, sparse: false, pct };
}

/** What a row's hover text says about the findings behind its rates. */
export function sampleNote(decided: number, total: number): string {
  return decided > 0
    ? `${decided} decided of ${total} total`
    : `${total} findings, none decided yet`;
}
