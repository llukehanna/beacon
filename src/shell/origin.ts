/**
 * Where a visitor came from when they opened a firm's tear sheet, carried in the router's
 * location state so the breadcrumb and the back link can name the screen they actually left. A
 * tear sheet opened any other way (a pasted link, the palette) reads as coming from the Pipeline.
 */
export interface TearSheetOrigin {
  from: "desk";
}

/** The location state a link from the Desk passes. */
export const FROM_DESK: TearSheetOrigin = { from: "desk" };

/** True when the location state says the Desk opened this page. */
export function cameFromDesk(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "from" in state &&
    (state as { from?: unknown }).from === FROM_DESK.from
  );
}
