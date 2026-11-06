const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long before `now` an ISO timestamp was: "now", "5m", "2h", "3d", "6w", "4mo". Null when the
 * timestamp is missing or unreadable, so no age is shown rather than a guessed one.
 */
export function relativeAge(iso: string | null | undefined, now: number): string | null {
  const then = iso === null || iso === undefined ? Number.NaN : new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) {
    return "now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days < 14) {
    return `${days}d`;
  }
  return days < 60 ? `${Math.floor(days / 7)}w` : `${Math.floor(days / 30)}mo`;
}

/** An ISO timestamp for a stored time (ISO string, epoch milliseconds or Date); null when it is unreadable. */
export function toIsoTime(ts: unknown): string | null {
  const ms =
    ts instanceof Date
      ? ts.getTime()
      : typeof ts === "string" || typeof ts === "number"
        ? new Date(ts).getTime()
        : Number.NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
