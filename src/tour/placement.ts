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

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/**
 * Where the card should sit. Under 900 px it is a sheet on whichever edge leaves the anchor
 * uncovered. Wider, it floats beside the anchor: right, then left, then below, then above, then a
 * corner of the viewport, and takes the candidate that covers the least page content: `obstacles`
 * are the boxes of text, controls and the anchor itself. Ties go to the earlier candidate, so with
 * no obstacles it is the first side with room. With no anchor it is centred; with no side that
 * fits (an anchor that fills the viewport) it settles in the bottom-right corner.
 */
export function placeCard(
  anchor: Box | null,
  card: Size,
  view: Size,
  narrow: boolean,
  obstacles: readonly Box[] = [],
  /** The main content area; the corner candidates sit inside it, clear of the sidebar and bars. Defaults to the viewport. */
  area: Box = { top: 0, left: 0, width: view.width, height: view.height },
): Placement {
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
  const right = area.left + area.width - card.width - MARGIN;
  const bottom = area.top + area.height - card.height - MARGIN;
  const left = area.left + MARGIN;
  const top = area.top + MARGIN;
  const candidates: { top: number; left: number }[] = [];
  if (rightSpace >= roomX) {
    candidates.push({ top: alignTop, left: anchor.left + anchor.width + GAP });
  }
  if (leftSpace >= roomX) {
    candidates.push({ top: alignTop, left: anchor.left - GAP - card.width });
  }
  if (belowSpace >= roomY) {
    candidates.push({ top: anchor.top + anchor.height + GAP, left: alignLeft });
  }
  if (aboveSpace >= roomY) {
    candidates.push({ top: anchor.top - GAP - card.height, left: alignLeft });
  }
  // Corners last: they are what is left when no side of the anchor is free.
  candidates.push(
    { top: bottom, left: right },
    { top: bottom, left },
    { top, left: right },
    { top, left },
  );
  const cost = (c: { top: number; left: number }): number => {
    const box: Box = { top: c.top, left: c.left, width: card.width, height: card.height };
    return obstacles.reduce((sum, o) => sum + overlap(box, o), 0);
  };
  let best = candidates[0];
  let bestCost = cost(best);
  for (const c of candidates.slice(1)) {
    const k = cost(c);
    if (k < bestCost) {
      best = c;
      bestCost = k;
    }
  }
  return { kind: "float", ...best };
}
