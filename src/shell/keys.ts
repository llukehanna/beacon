/** Keyboard navigation shared by the shell: the go-to table and the typing guard. */

/** `G` then one of these keys jumps to a route (U is Rules, since R is Review). */
export const GO_KEYS = {
  h: "/",
  d: "/desk",
  p: "/pipeline",
  r: "/review",
  u: "/rules",
  a: "/accuracy",
  m: "/mandate",
} as const;

export type GoKey = keyof typeof GO_KEYS;

export function isGoKey(key: string): key is GoKey {
  return Object.prototype.hasOwnProperty.call(GO_KEYS, key);
}

/**
 * True when the global go-to keys must stay out of this keydown: any Ctrl, Cmd or Alt chord, a
 * held-down repeat, and any Shift chord except `?` (which is typed with Shift). Shift chords
 * belong to the screens: on the Desk, Shift+A advances a firm, so G then Shift+A must not go to
 * Accuracy.
 */
export function goKeysIgnore(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
}): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || e.repeat || (e.shiftKey && e.key !== "?");
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when keystrokes on this element are text for the user to type, so a single-key
 * shortcut must not fire. Covers input, textarea, select and contenteditable.
 */
export function isTypingTarget(el: Element | null): boolean {
  if (el === null) {
    return false;
  }
  if (TYPING_TAGS.has(el.tagName.toUpperCase())) {
    return true;
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * The Desk's firm-level decisions. They are Shift chords so they cannot be hit by accident, and so
 * they never collide with the plain letters that act on the selected axis (V verifies, R rejects
 * its value, P and F pass or fail a gate).
 */
export const FIRM_DECISION_KEYS = {
  qualify: { letter: "q", label: "⇧Q" },
  advance: { letter: "a", label: "⇧A" },
  pass: { letter: "r", label: "⇧R" },
} as const;

export type FirmDecisionKey = keyof typeof FIRM_DECISION_KEYS;

/** Which firm-level decision a keydown asks for, if any. Ignores Ctrl, Cmd and Alt chords. */
export function firmDecisionKey(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): FirmDecisionKey | null {
  if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) {
    return null;
  }
  const letter = e.key.toLowerCase();
  const found = (Object.keys(FIRM_DECISION_KEYS) as FirmDecisionKey[]).find(
    (k) => FIRM_DECISION_KEYS[k].letter === letter,
  );
  return found ?? null;
}

/** True while a modal (a dialog, the demo reset confirmation, a drawer) owns the keyboard. */
export function modalIsOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"]') !== null;
}

export interface NavItem {
  to: (typeof GO_KEYS)[GoKey];
  label: string;
  /** The go-to key, shown as a hint next to the label. */
  key: GoKey;
}

/** The seven workspace routes, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", key: "h" },
  { to: "/desk", label: "Desk", key: "d" },
  { to: "/pipeline", label: "Pipeline", key: "p" },
  { to: "/review", label: "Review", key: "r" },
  { to: "/rules", label: "Rules", key: "u" },
  { to: "/accuracy", label: "Accuracy", key: "a" },
  { to: "/mandate", label: "Mandates", key: "m" },
];

/** The nav entry a path belongs to; the mandate search page sits under Mandates. */
export function navItemFor(pathname: string): NavItem | undefined {
  if (pathname.startsWith("/search/")) {
    return NAV_ITEMS.find((n) => n.to === "/mandate");
  }
  return NAV_ITEMS.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)));
}

/** The two pages linked from the sidebar footer. They have no go-to key. */
export const FOOTER_LINKS = [
  { to: "/about", label: "About" },
  { to: "/trust", label: "Trust" },
] as const;

/** The footer page a path belongs to, for the breadcrumb. */
export function footerLinkFor(pathname: string): (typeof FOOTER_LINKS)[number] | undefined {
  return FOOTER_LINKS.find((l) => l.to === pathname);
}
