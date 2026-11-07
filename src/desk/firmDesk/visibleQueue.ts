import { type ScreeningRule, isLiveQueueFirm } from "../activeScreening";
import { type RankedFirm } from "../queue";

/**
 * The firms the queue lists: the live queue by default, every firm in scope when the analyst is
 * searching, has switched on "Show all firms" or has a search or mandate pinned, and then those
 * whose name or id contains the search text. The sidebar draws this list and the Desk moves along
 * it after a pass, so the next firm is always one the analyst can see.
 */
export function visibleQueue(
  queue: readonly RankedFirm[],
  {
    query,
    showAll,
    membershipPinned,
    screeningRules,
    openIds,
  }: {
    query: string;
    showAll: boolean;
    membershipPinned: boolean;
    screeningRules: readonly ScreeningRule[];
    /** Ids of the open firms, per the funnel (`isOpenFirm`). */
    openIds: ReadonlySet<string>;
  },
): RankedFirm[] {
  const needle = query.trim().toLowerCase();
  const searching = needle !== "";
  // The search box reaches every firm in scope regardless of the switch: an analyst looking up a
  // firm by name should never have to know it was screened or already decided to find it.
  const base =
    searching || showAll || membershipPinned
      ? [...queue]
      : queue.filter((r) =>
          // The predicate the sidebar's header counts, so the list and "N in live queue" agree.
          isLiveQueueFirm(r.firm, screeningRules, openIds.has(r.firm.firmId)),
        );
  if (!searching) {
    return base;
  }
  return base.filter(
    (r) =>
      (r.firm.firmName ?? "").toLowerCase().includes(needle) ||
      (r.firm.firmId ?? "").toLowerCase().includes(needle),
  );
}
