/**
 * A tab opened before a deploy still points at chunk files the new build
 * replaced; navigating to a lazy route then fails to import. These are the
 * messages browsers give for that.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(
    message,
  );
}

const RELOAD_KEY = "beacon:chunk-reload-at";
/** A second chunk failure inside this window means a reload did not help; show the error instead. */
const RELOAD_WINDOW_MS = 30_000;

interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * True once per window: the caller should reload the page. The mark is kept in
 * sessionStorage so a reload that hits the same failure cannot loop; with no
 * usable storage it errs toward showing the panel rather than reloading.
 */
export function claimChunkReload(store: SessionStore | null, now: number = Date.now()): boolean {
  if (!store) {
    return false;
  }
  try {
    const last = Number(store.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) {
      return false;
    }
    store.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
