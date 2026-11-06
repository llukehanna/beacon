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
