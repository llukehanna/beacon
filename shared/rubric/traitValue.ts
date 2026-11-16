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

const CURRENCY = /^[$€£¥]/;

/**
 * How much of a number's unit to show: all of it ("9 yrs"), only a currency ("$40m", while a
 * count stays bare: "9"), or none (the bare value, for exports and other programs).
 */
export type UnitStyle = "all" | "currency" | "none";

/**
 * A trait value for a person to read. A yes/no trait reads as Pass or Fail by its polarity (Yes or
 * No when it has none), and a number carries its unit as `units` says: "$40m" for a unit of "$m",
 * "9 yrs" for "yrs".
 */
export function showTraitValue(
  trait: Pick<TraitDef, "kind" | "unit" | "passWhen">,
  v: TraitValue | null | undefined,
  options: { units?: UnitStyle } = {},
): string {
  if (v === null || v === undefined || v === "") {
    return "—";
  }
  if (trait.kind === "yesno" && typeof v === "boolean") {
    if (trait.passWhen === null) {
      return v ? "Yes" : "No";
    }
    return v === trait.passWhen ? "Pass" : "Fail";
  }
  const unit = trait.unit;
  const units = options.units ?? "all";
  if (units !== "none" && trait.kind === "number" && typeof v === "number" && unit) {
    if (CURRENCY.test(unit)) {
      return `${unit[0]}${v}${unit.slice(1)}`;
    }
    if (units === "all") {
      return `${v} ${unit}`;
    }
  }
  return String(v);
}
