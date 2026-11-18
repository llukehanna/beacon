import type { Traits } from "./types.js";

type FirmLike = Readonly<Record<string, unknown>>;

/** A firm's current trait values (the derived `traits` property the API attaches). */
export function traitsOf(firm: FirmLike): Traits {
  const t = firm.traits;
  return t !== null && typeof t === "object" ? (t as Traits) : {};
}

/** The thesis key a firm is scored under, or null to use the rubric's default. */
export function thesisOf(firm: FirmLike): string | null {
  const v = firm.thesis;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
