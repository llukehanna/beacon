/**
 * Whole percent that never reads 100 while some part is missing: 5,429 of 5,430 is 99%, not 100%.
 * Zero when there is no whole.
 */
export function sharePercent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  const pct = Math.round((part / whole) * 100);
  return part < whole ? Math.min(pct, 99) : pct;
}
