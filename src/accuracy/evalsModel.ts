// Pure helpers behind the Evals tab: how a report figure reads, and where an example firm opens.
import type { EvalReport } from "../../shared/evalReport";

/** A 0 to 1 rate as a percentage with one decimal, or an em dash when it could not be measured. */
export function evalPct(rate: number | null): string {
  return rate === null ? "—" : (rate * 100).toFixed(1);
}

/** The Desk, on the given firm. */
export function deskHref(firmId: string): string {
  return `/desk?firmId=${encodeURIComponent(firmId)}`;
}

/**
 * What an example firm is called: its name once the firms are in, a dash while they load, and a
 * plain phrase for a firm this persona cannot see. A firm id is never shown.
 */
export function exampleFirmName(
  firmId: string,
  names: ReadonlyMap<string, string> | undefined,
): string {
  if (names === undefined) {
    return "…";
  }
  return names.get(firmId) ?? "A firm outside this view";
}

/**
 * The line under the headline measures that says what tier agreement is: measured before any
 * analyst input, where an abstained or conflicted axis counts as unknown. Of the axes that did not
 * end with the true value, the abstentions and the wrong settled values are named, so a low figure
 * reads as "mostly unknown", not "mostly wrong".
 */
export function tierFraming(report: EvalReport): string {
  const count = (kind: string): number => report.failures.find((f) => f.kind === kind)?.count ?? 0;
  const abstained = count("abstained-correctly") + count("abstained-wrongly");
  const conflicts = count("conflict-surfaced");
  const wrong = count("wrong-source-wins");
  return `Tier agreement is measured before any analyst input, with abstained and conflicted axes counted as unknown. Of the axes that did not end with the true value, ${evalCount(abstained)} are abstentions, ${evalCount(conflicts)} are conflicts left to the analyst and ${evalCount(wrong)} are wrong settled values.`;
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
