const KEY = "beacon.intro.dismissed";

/** True once the visitor has closed the Home intro card. Storage that cannot be read counts as not dismissed. */
export function introDismissed(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers that the intro card was closed. Never throws: blocked storage just means it shows again. */
export function dismissIntro(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(KEY, "1");
  } catch {
    // Private windows and blocked site data: the card simply returns next visit.
  }
}

/** The browser's local storage, or null where touching it throws. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
