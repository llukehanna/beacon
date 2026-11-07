import type { NeedsYouItem } from "../../shared/summaries";

/** Which mark a row carries; the page maps these to colour (see NeedsYou.module.css). */
export type NeedsTone = "down" | "up" | "attention" | "judgment" | "rule";

export interface NeedsRow {
  key: string;
  /** Where the row opens. */
  to: string;
  /** One glyph that names the kind of work. */
  mark: string;
  tone: NeedsTone;
  name: string;
  reason: string;
  /** The mono figure in the row: a tier change, an open count, firms a rule would screen. */
  figure: { from?: string; to?: string; text?: string } | null;
  /** ISO time the item arose; null when none was recorded. */
  at: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function tierLabel(tier: string | undefined, score: number | undefined): string | null {
  const t = (tier ?? "").trim();
  if (t === "") {
    return null;
  }
  return score === undefined ? t : `${t} ${score}`;
}

/** Positive when the firm moved up. Scores decide; tier letters (A best) are the fallback. */
export function direction(
  priorTier: string | undefined,
  priorScore: number | undefined,
  newTier: string | undefined,
  newScore: number | undefined,
): number {
  if (priorScore !== undefined && newScore !== undefined && priorScore !== newScore) {
    return Math.sign(newScore - priorScore);
  }
  const a = (priorTier ?? "").trim();
  const b = (newTier ?? "").trim();
  return a !== "" && b !== "" && a !== b ? (a < b ? -1 : 1) : 0;
}

/** How one needs-you item reads in the Home list. */
export function needsRow(item: NeedsYouItem): NeedsRow {
  switch (item.kind) {
    case "drift": {
      const reason = (item.driftReason ?? "").toLowerCase();
      const from = tierLabel(item.priorTier, item.priorScore);
      const to = tierLabel(item.newTier, item.newScore);
      const moved = from !== null && to !== null ? { from, to } : null;
      const base = { key: item.key, to: "/review", name: item.name, at: item.at };
      if (reason === "outcome_diverged") {
        return {
          ...base,
          mark: "!",
          tone: "attention",
          // The server opens outcome_diverged only when a passed firm is acquired by a competitor.
          reason: "passed; later acquired by a competitor",
          figure: null,
        };
      }
      if (reason === "pass_reason_invalidated") {
        return {
          ...base,
          mark: "!",
          tone: "attention",
          reason: "the reason we passed no longer holds",
          figure: { text: "re-open?" },
        };
      }
      const dir = direction(item.priorTier, item.priorScore, item.newTier, item.newScore);
      return {
        ...base,
        mark: dir < 0 ? "↓" : dir > 0 ? "↑" : "!",
        tone: dir < 0 ? "down" : dir > 0 ? "up" : "attention",
        reason: reason === "tier_moved" ? "tier moved after new evidence" : "drift detected",
        figure: moved,
      };
    }
    case "judgment":
      return {
        key: item.key,
        // /desk reads ?firmId and opens that firm's panel.
        to: `/desk?firmId=${encodeURIComponent(item.firmId)}`,
        mark: "?",
        tone: "judgment",
        name: item.name,
        reason: `${plural(item.axes, "axis", "axes")} had no source, needs judgment`,
        figure: { text: `${item.axes} open` },
        at: item.at,
      };
    case "rule":
      return {
        key: item.key,
        to: "/rules",
        mark: "+",
        tone: "rule",
        name: item.name,
        reason: "proposed screening rule",
        // null means the predicate cannot be counted, not that it screens nobody.
        figure: item.screens === null ? null : { text: `screens ${item.screens}` },
        at: item.at,
      };
  }
}
