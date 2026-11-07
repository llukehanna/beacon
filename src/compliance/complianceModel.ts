/** Pure helpers for the Compliance page: names for the rows and a stable, readable time. */
import { PERSONA_LABELS, isPersona } from "../../shared/accessPolicy";

export function personaLabel(persona: string | undefined): string {
  return persona !== undefined && isPersona(persona) ? PERSONA_LABELS[persona] : (persona ?? "—");
}

/** "2026-09-01 12:00 UTC": fixed, so the log reads the same in every time zone. */
export function logTime(iso: string | undefined): string {
  if (iso === undefined) {
    return "—";
  }
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : `${t.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface LogRow {
  entryId: string;
  persona?: string;
  objectType?: string;
  objectId?: string;
  viewedAt?: string;
}

/** What a log row's object is called: the firm's or mandate's name when known, else its id. */
export function objectName(
  row: Pick<LogRow, "objectType" | "objectId">,
  firmNames: ReadonlyMap<string, string>,
  mandateNames: ReadonlyMap<string, string>,
): string {
  const id = row.objectId ?? "";
  const names = row.objectType === "Mandate" ? mandateNames : firmNames;
  return names.get(id) ?? id;
}
