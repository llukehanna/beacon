export interface MetricTrend {
  points: number[];
  /** Change in percentage points across the series; null when it has none. */
  delta: number | null;
}

/**
 * What a metric card may draw. A flat series (every point equal) says nothing, so it shows no
 * line and no delta; a delta of zero is never shown either.
 */
export function visibleTrend(trend: MetricTrend | null | undefined): {
  points: number[] | null;
  delta: number | null;
} {
  const points = trend?.points ?? [];
  const varies = points.length >= 2 && points.some((p) => p !== points[0]);
  const delta = trend?.delta ?? null;
  return {
    points: varies ? points : null,
    delta: varies && delta !== null && delta !== 0 ? delta : null,
  };
}
