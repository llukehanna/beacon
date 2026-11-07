import { TOUR_FIRM_ID } from "../../shared/showcaseFirms";

/** One stop on the guided tour: where it happens, what it points at and what it says. */
export interface TourStep {
  id: string;
  /** The route the stop lives on. */
  route: string;
  /** Query parameters the stop needs, filled in when the URL lacks them (the Desk's firm). */
  params?: Readonly<Record<string, string>>;
  /** The `data-tour` value of the element to highlight; null shows a centred card instead. */
  anchor: string | null;
  /**
   * The `data-tour` value of an element that must be fully on screen, above the card, on a narrow
   * screen: the Desk's whole decision bar for the note box it points at. Defaults to the anchor.
   */
  reveal?: string;
  title: string;
  body: string;
}

/** The Desk stops open on a firm whose agent run is nearly complete, not on whichever leads the queue. */
const DESK = { firmId: TOUR_FIRM_ID };

/** The six stops, in order. The tour reads and highlights; it never changes stored data. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "mandate",
    route: "/mandate",
    anchor: "mandate",
    title: "Start from a mandate",
    body: "Leadership writes what it is after in plain words. Beacon turns that intent into a search and assembles the universe of firms to work through.",
  },
  {
    id: "conflict",
    route: "/desk",
    params: DESK,
    anchor: "conflict-row",
    title: "When two sources disagree",
    body: "Here two sources gave different values for the same axis. Beacon does not average them or quietly pick one. It shows both, and the analyst chooses the one they trust.",
  },
  {
    id: "evidence",
    route: "/desk",
    params: DESK,
    anchor: "evidence",
    title: "Every value cites its source",
    body: "Each value points at the sentence it was read from and has to pass grounding checks. Where no source supports an axis, Beacon records an abstention instead of guessing.",
  },
  {
    id: "pass",
    route: "/desk",
    params: DESK,
    anchor: "pass-note",
    reveal: "decision-bar",
    title: "Passing takes a reason",
    body: "To pass on a firm you write down why in this note. The tour only points at it and never presses Pass. Those reasons are the raw material for rules.",
  },
  {
    id: "rule",
    route: "/rules",
    anchor: "proposed-rule",
    title: "Reasons become proposed rules",
    body: "When enough passes share a reason, Beacon drafts a screening rule. It shows the passes it came from and how many firms it would screen, and nothing takes effect until you approve it.",
  },
  {
    id: "drift",
    route: "/review",
    anchor: "drift-list",
    title: "Drift keeps decisions honest",
    body: "When a firm you decided on changes enough to matter, it returns here with the reason it surfaced, so an old call is looked at again instead of silently going stale.",
  },
];
