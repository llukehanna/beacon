/**
 * Any value as text, the way `String` writes it. Firm columns, error values and thrown things are
 * unknown at this point; an object that has no text of its own prints as "[object Object]", which
 * is the fallback these callers want rather than an error.
 */
export function looseText(value: unknown): string {
  return String(value);
}
