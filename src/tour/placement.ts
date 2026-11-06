/** A rectangle in viewport pixels. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Where the tour card goes: pinned to the top or bottom edge as a sheet, or floating at a point. */
export type Placement =
  { kind: "sheet"; side: "top" | "bottom" } | { kind: "float"; top: number; left: number };

/** Space kept between the card and the anchor, and between the card and the viewport edge. */
export const GAP = 14;
export const MARGIN = 12;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(n, lo), Math.max(lo, hi));

/**
 * Where the card should sit. Under 900 px it is a sheet on whichever edge leaves the anchor
 * uncovered. Wider, it floats beside the anchor: right, then left, then below, then above, taking
 * the first side with room. With no anchor it is centred; with no side that fits (an anchor that
 * fills the viewport) it settles in the bottom-right corner.
 */
export function placeCard(anchor: Box | null, card: Size, view: Size, narrow: boolean): Placement {
  if (narrow) {
    if (anchor === null) {
      return { kind: "sheet", side: "bottom" };
    }
    const below = view.height - (anchor.top + anchor.height);
    const above = anchor.top;
    const need = card.height + GAP;
    if (below >= need) {
      return { kind: "sheet", side: "bottom" };
    }
    if (above >= need) {
      return { kind: "sheet", side: "top" };
    }
    return { kind: "sheet", side: below >= above ? "bottom" : "top" };
  }
  if (anchor === null) {
    return {
      kind: "float",
      top: Math.max(MARGIN, (view.height - card.height) / 2),
      left: Math.max(MARGIN, (view.width - card.width) / 2),
    };
  }
  const rightSpace = view.width - (anchor.left + anchor.width);
  const leftSpace = anchor.left;
  const belowSpace = view.height - (anchor.top + anchor.height);
  const aboveSpace = anchor.top;
  const alignTop = clamp(anchor.top, MARGIN, view.height - card.height - MARGIN);
  const alignLeft = clamp(anchor.left, MARGIN, view.width - card.width - MARGIN);
  const roomX = card.width + GAP + MARGIN;
  const roomY = card.height + GAP + MARGIN;
  if (rightSpace >= roomX) {
    return { kind: "float", top: alignTop, left: anchor.left + anchor.width + GAP };
  }
  if (leftSpace >= roomX) {
    return { kind: "float", top: alignTop, left: anchor.left - GAP - card.width };
  }
  if (belowSpace >= roomY) {
    return { kind: "float", top: anchor.top + anchor.height + GAP, left: alignLeft };
  }
  if (aboveSpace >= roomY) {
    return { kind: "float", top: anchor.top - GAP - card.height, left: alignLeft };
  }
  return {
    kind: "float",
    top: view.height - card.height - MARGIN,
    left: view.width - card.width - MARGIN,
  };
}
