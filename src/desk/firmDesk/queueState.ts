/** The one-line state under each queue row: when the agent last ran and what is waiting. */
import { relativeAge } from "@/home/age";
import { type FindingLike, classifyAxis, pickAuthoritative } from "../axisState";

export interface FindingCounts {
  /** Conflict groups with a side still unresolved. */
  conflicts: number;
  /** Axes whose authoritative finding is a proposal nobody has verified. */
  proposed: number;
  /** Axes whose authoritative finding abstained (no source had a value). */
  abstained: number;
}

interface FirmFinding extends FindingLike {
  firmId?: string;
}

const isConflictGroup = (f: FindingLike): boolean =>
  f.conflictGroupId !== undefined && f.conflictGroupId !== null && f.conflictGroupId !== "";

/**
 * Per-firm counts using the grouping the findings section renders: superseded findings are
 * invisible, findings sharing a conflict group form one conflict, and each remaining axis counts
 * once by its authoritative finding. Firms with nothing waiting are absent from the map.
 */
export function findingCountsByFirm(findings: readonly FirmFinding[]): Map<string, FindingCounts> {
  const visible = new Map<string, FirmFinding[]>();
  for (const f of findings) {
    const firmId = f.firmId ?? "";
    if (firmId === "" || (f.findingStatus ?? "").toLowerCase() === "superseded") {
      continue;
    }
    const list = visible.get(firmId) ?? [];
    list.push(f);
    visible.set(firmId, list);
  }

  const out = new Map<string, FindingCounts>();
  for (const [firmId, list] of visible) {
    const groups = new Map<string, FindingLike[]>();
    const byAxis = new Map<string, FindingLike[]>();
    for (const f of list) {
      const bucket = isConflictGroup(f) ? groups : byAxis;
      const key = isConflictGroup(f) ? (f.conflictGroupId as string) : (f.axis ?? "");
      bucket.set(key, [...(bucket.get(key) ?? []), f]);
    }
    const counts: FindingCounts = { conflicts: 0, proposed: 0, abstained: 0 };
    for (const members of groups.values()) {
      if (members.some((m) => (m.findingStatus ?? "").toLowerCase() === "proposed")) {
        counts.conflicts++;
      }
    }
    for (const members of byAxis.values()) {
      const state = classifyAxis(pickAuthoritative(members));
      if (state === "proposed") {
        counts.proposed++;
      } else if (state === "abstained") {
        counts.abstained++;
      }
    }
    if (counts.conflicts + counts.proposed + counts.abstained > 0) {
      out.set(firmId, counts);
    }
  }
  return out;
}

/** "3m ago", "just now"; null when the time is missing or unreadable. */
export function agoText(iso: string | null | undefined, now: number): string | null {
  const age = relativeAge(iso, now);
  if (age === null) {
    return null;
  }
  return age === "now" ? "just now" : `${age} ago`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * "Agent ran 2m ago · 1 conflict", "3 proposed", "Not yet enriched". Shows the most pressing
 * thing waiting: conflicts first, then proposals, then axes no source could fill.
 */
export function queueStateLine(opts: {
  enrichedAt: string | null | undefined;
  enrichedBy: string | null | undefined;
  agent: string;
  counts: FindingCounts | undefined;
  now: number;
}): string {
  const when = agoText(opts.enrichedAt, opts.now);
  const parts: string[] = [];
  if (when === null) {
    parts.push("Not yet enriched");
  } else {
    parts.push(opts.enrichedBy === opts.agent ? `Agent ran ${when}` : `Enriched ${when}`);
  }
  const c = opts.counts;
  if (c !== undefined) {
    if (c.conflicts > 0) {
      parts.push(plural(c.conflicts, "conflict", "conflicts"));
    } else if (c.proposed > 0) {
      parts.push(`${c.proposed} proposed`);
    } else if (c.abstained > 0) {
      parts.push(plural(c.abstained, "axis without a source", "axes without a source"));
    }
  }
  return parts.join(" · ");
}
