// Pure helpers behind the Evals tab: how a report figure reads, and where an example firm opens.

/** A 0 to 1 rate as a percentage with one decimal, or an em dash when it could not be measured. */
export function evalPct(rate: number | null): string {
  return rate === null ? "—" : (rate * 100).toFixed(1);
}

/** The Desk, on the given firm. */
export function deskHref(firmId: string): string {
  return `/desk?firmId=${encodeURIComponent(firmId)}`;
}

/** Thousands separators, the way every count on the page reads. */
export const evalCount = (n: number): string => n.toLocaleString("en-US");

export type AccuracyTab = "overview" | "evals" | "operations";

/** The tab named by the `tab` query parameter; anything else is the overview. */
export function tabFromParam(param: string | null): AccuracyTab {
  return param === "evals" || param === "operations" ? param : "overview";
}

/** Where a key moves the selection in a row of `count` tabs, or null when the key does nothing: arrows wrap, Home and End jump. */
export function tabTarget(key: string, at: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (at + 1) % count;
    case "ArrowLeft":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
