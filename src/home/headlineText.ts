import type { HeadlineCounts } from "../../shared/activityFeed";
import type { NeedsYouDestination } from "../../shared/summaries";

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

export interface NeedsPart {
  destination: NeedsYouDestination;
  /** "11 drift to review". */
  text: string;
  /** Where that kind of work is done. */
  to: string;
}

/**
 * The headline total split by where each item is worked, so it reconciles with the Review badge
 * (drift only): "11 drift to review", "43 firms to resolve", "3 proposed rules". Kinds with
 * nothing waiting are left out.
 */
export function needsParts(
  counts: Readonly<Record<NeedsYouDestination, number>> | undefined,
): NeedsPart[] {
  if (counts === undefined) {
    return [];
  }
  const parts: NeedsPart[] = [
    { destination: "review", text: `${counts.review} drift to review`, to: "/review" },
    {
      destination: "desk",
      text: `${plural(counts.desk, "firm")} to resolve`,
      to: "/desk",
    },
    { destination: "rules", text: `${plural(counts.rules, "proposed rule")}`, to: "/rules" },
  ];
  return parts.filter((p) => counts[p.destination] > 0);
}
