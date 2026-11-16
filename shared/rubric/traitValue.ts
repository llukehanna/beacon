import type { TraitDef, TraitValue } from "./types.js";

export class TraitValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraitValueError";
  }
}

/**
 * A value as an action receives it, checked against its trait's kind: a finite
 * number, a non-empty string, or a boolean. Null clears the trait.
 */
export function checkTraitValue(trait: TraitDef, v: unknown): TraitValue | null {
  if (v === null) {
    return null;
  }
  const ok =
    trait.kind === "number"
      ? typeof v === "number" && Number.isFinite(v)
      : trait.kind === "yesno"
        ? typeof v === "boolean"
        : typeof v === "string" && v.trim() !== "";
  if (!ok) {
    const want =
      trait.kind === "number" ? "a number" : trait.kind === "yesno" ? "true or false" : "a label";
    throw new TraitValueError(`${trait.traitKey} must be ${want}, got ${JSON.stringify(v)}`);
  }
  return v as TraitValue;
}

/** Parse a finding's string value into its trait's type; null when it does not parse. */
export function parseTraitValue(trait: Pick<TraitDef, "kind">, raw: string): TraitValue | null {
  const s = raw.trim();
  if (s === "") {
    return null;
  }
  if (trait.kind === "number") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (trait.kind === "yesno") {
    const l = s.toLowerCase();
    if (["yes", "true", "y", "1"].includes(l)) {
      return true;
    }
    if (["no", "false", "n", "0"].includes(l)) {
      return false;
    }
    return null;
  }
  return s;
}

export function formatTraitValue(v: TraitValue): string {
  return String(v);
}
