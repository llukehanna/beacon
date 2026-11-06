/** A firm's stored scores as a history list. Pure. */

interface ScoreRow {
  scoreId?: string;
  weightedTotal?: number | null;
  computedAt?: unknown;
}

export interface ScoreEntry {
  id: string;
  at: number;
  total: number;
  /** Change from the score before this one; null for the first. */
  change: number | null;
}

const toMs = (raw: unknown): number =>
  raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();

/** Newest first, each with its change from the score before it; rows with no readable time or total are dropped. */
export function scoreHistory(rows: readonly ScoreRow[]): ScoreEntry[] {
  const dated = rows
    .map((r) => ({ id: r.scoreId ?? "", at: toMs(r.computedAt), total: r.weightedTotal }))
    .filter(
      (r): r is { id: string; at: number; total: number } =>
        !Number.isNaN(r.at) && typeof r.total === "number" && Number.isFinite(r.total),
    )
    .sort((a, b) => a.at - b.at);
  return dated
    .map((r, i) => ({ ...r, change: i === 0 ? null : r.total - dated[i - 1].total }))
    .reverse();
}
