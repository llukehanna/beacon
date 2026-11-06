import type { HeadlineCounts } from "../../shared/activityFeed";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface HeadlineText {
  /** What needs the analyst, in one plain sentence. */
  lead: string;
  /**
   * What the agent's latest runs did; null when no firm has been enriched. "Declined to guess"
   * counts only abstentions nothing has settled since, hence "still open".
   */
  detail: string | null;
}

/** The page title, built from counts only. */
export function headlineText(needsYouTotal: number, headline: HeadlineCounts | null): HeadlineText {
  const lead =
    needsYouTotal === 0
      ? "Nothing needs you."
      : needsYouTotal === 1
        ? "1 item needs you."
        : `${needsYouTotal} items need you.`;
  if (headline === null) {
    return { lead, detail: null };
  }
  const axes = headline.abstainedAxes;
  const declined =
    axes === 0
      ? "left no axis open"
      : `declined to guess on ${plural(axes, "axis", "axes")} that ${axes === 1 ? "is" : "are"} still open`;
  return {
    lead,
    detail: `The agent's latest runs enriched ${plural(headline.enrichedFirms, "firm")} and ${declined}.`,
  };
}
