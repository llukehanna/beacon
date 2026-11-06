/** The score a firm had before its last enrichment, from the persisted score history. */

interface ScoreRow {
  weightedTotal?: number | null;
  computedAt?: unknown;
}

const toMs = (raw: unknown): number => {
  if (raw === null || raw === undefined) {
    return Number.NaN;
  }
  return raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
};

/**
 * The total of the latest score row computed strictly before `enrichedAt`; null when the firm was
 * never enriched or no earlier row exists, so the meter shows no ghost rather than a guess.
 */
export function priorScoreBefore(rows: readonly ScoreRow[], enrichedAt: unknown): number | null {
  const cutoff = toMs(enrichedAt);
  if (Number.isNaN(cutoff)) {
    return null;
  }
  let best: { at: number; total: number } | null = null;
  for (const row of rows) {
    const at = toMs(row.computedAt);
    const total = row.weightedTotal;
    if (Number.isNaN(at) || at >= cutoff || typeof total !== "number" || !Number.isFinite(total)) {
      continue;
    }
    if (best === null || at > best.at) {
      best = { at, total };
    }
  }
  return best === null ? null : best.total;
}

/**
 * How much the last enrichment moved the stored score: the stored total less the total before it.
 * Zero (nothing to show) when there is no earlier score or the firm is hard-rejected, whose total
 * is zero by definition rather than a change.
 */
export function enrichmentDelta(
  storedTotal: number,
  prior: number | null,
  hardRejected: boolean,
): number {
  return prior === null || hardRejected ? 0 : storedTotal - prior;
}
