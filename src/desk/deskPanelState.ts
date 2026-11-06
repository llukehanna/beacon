/**
 * What the Desk's right-hand panel shows. One state at a time, so the loading, empty, not-found
 * and error panels can never stack or contradict each other.
 */
export type DeskPanelState =
  /** The selected firm is in the current view: render the enrichment panel. */
  | "firm"
  /** A requested firm (`?firmId=`) is still resolving. */
  | "skeleton"
  /** The firm or search-membership queries failed; the error banner carries the reason. */
  | "error"
  /** The requested id is not in the database at all. */
  | "not-found"
  /** The requested firm exists but the active search filter excludes it. */
  | "not-in-search"
  /** An active search has no firms to show (or its membership is still loading). */
  | "search-empty"
  /** There are no firms at all (and no search is pinned): say how to fill the queue. */
  | "queue-empty"
  /** Nothing selected: prompt to pick from the queue. */
  | "empty";

export interface DeskPanelInputs {
  /** `?firmId=` / the clicked queue row, if any. */
  selectedId: string | undefined;
  /** The Firm list is still loading (including remaining pages). */
  firmsLoading: boolean;
  /** Search membership is still loading (search pinned, links not resolved). */
  membershipLoading: boolean;
  /** Any of the firm or membership queries failed. */
  hasError: boolean;
  searchActive: boolean;
  /** The selected firm is among the firms the view shows (search-filtered when a search is pinned). */
  inView: boolean;
  /** The selected firm exists in the full, unfiltered firm list. */
  inDatabase: boolean;
  /** Number of firms in the current view. */
  viewCount: number;
}

export function deskPanelState(i: DeskPanelInputs): DeskPanelState {
  if (i.selectedId !== undefined && i.inView) {
    return "firm";
  }
  if (i.hasError) {
    return "error";
  }
  const loading = i.firmsLoading || i.membershipLoading;
  if (i.selectedId !== undefined) {
    if (loading) {
      return "skeleton";
    }
    return i.searchActive && i.inDatabase ? "not-in-search" : "not-found";
  }
  if (i.searchActive && !i.firmsLoading && i.viewCount === 0) {
    return "search-empty";
  }
  if (!i.searchActive && !i.firmsLoading && i.viewCount === 0) {
    return "queue-empty";
  }
  return "empty";
}
