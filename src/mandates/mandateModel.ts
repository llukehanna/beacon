// Shapes and naming the mandate pages share.

export interface MandateLike {
  mandateId: string;
  title?: string | null;
  archetype?: string | null;
  priority?: string | null;
  // The primary headline; legacy mandates where only `title` was set fall back to it.
  intentStatement?: string | null;
  // Deprecated on the mandate: kept on the type so legacy rows do not trip the widened cast, but
  // no longer rendered or written from here.
  geographies?: readonly string[] | null;
  sizeMaxUsdM?: number | null;
}

export interface SearchListLike {
  searchId: string;
  name?: string | null;
  mandateId?: string | null;
}

/** A mandate's name: its intent statement, then its title, then its id so a malformed row still has an anchor. */
export function mandateHeadline(mandate: MandateLike): string {
  return (
    (mandate.intentStatement ?? "").trim() || (mandate.title ?? "").trim() || mandate.mandateId
  );
}
