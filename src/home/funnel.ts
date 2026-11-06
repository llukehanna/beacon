export interface FunnelBar {
  stage: string;
  count: number;
  /** Bar height in pixels. */
  px: number;
}

/**
 * One bar per stage, in the order given. Height is proportional to the largest count; a stage
 * with firms never drops below `minPx` (it must stay visible), and an empty stage has no bar.
 */
export function funnelBars(
  counts: Record<string, number>,
  stages: readonly string[],
  minPx = 6,
  maxPx = 56,
): FunnelBar[] {
  const largest = Math.max(0, ...stages.map((s) => counts[s] ?? 0));
  return stages.map((stage) => {
    const count = counts[stage] ?? 0;
    const px = count <= 0 ? 0 : Math.max(minPx, Math.round((count / largest) * maxPx));
    return { stage, count, px };
  });
}
