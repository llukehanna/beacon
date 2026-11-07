import { describe, expect, it } from "vitest";
import { GAP, placeCard } from "./placement";

const view = { width: 1440, height: 900 };
const card = { width: 340, height: 220 };

describe("placeCard on a wide screen", () => {
  it("centres the card when there is no anchor", () => {
    expect(placeCard(null, card, view, false)).toEqual({
      kind: "float",
      top: 340,
      left: 550,
    });
  });

  it("goes to the right of an anchor with room there", () => {
    const anchor = { top: 100, left: 300, width: 400, height: 80 };
    expect(placeCard(anchor, card, view, false)).toEqual({
      kind: "float",
      top: 100,
      left: 300 + 400 + GAP,
    });
  });

  it("goes to the left of an anchor on the right edge", () => {
    const anchor = { top: 100, left: 1100, width: 340, height: 600 };
    const p = placeCard(anchor, card, view, false);
    expect(p).toEqual({ kind: "float", top: 100, left: 1100 - GAP - card.width });
  });

  it("goes below a full-width row, then above when the row is low", () => {
    const row = { top: 200, left: 20, width: 1400, height: 40 };
    expect(placeCard(row, card, view, false)).toEqual({
      kind: "float",
      top: 200 + 40 + GAP,
      left: 20,
    });
    const low = { top: 800, left: 20, width: 1400, height: 60 };
    expect(placeCard(low, card, view, false)).toEqual({
      kind: "float",
      top: 800 - GAP - card.height,
      left: 20,
    });
  });

  it("never leaves the viewport", () => {
    const anchor = { top: 0, left: 0, width: 1440, height: 900 };
    const p = placeCard(anchor, card, view, false);
    expect(p.kind).toBe("float");
    if (p.kind === "float") {
      expect(p.left + card.width).toBeLessThanOrEqual(view.width);
      expect(p.top + card.height).toBeLessThanOrEqual(view.height);
    }
  });
});

describe("placeCard as a sheet", () => {
  const phone = { width: 390, height: 844 };
  const sheet = { width: 374, height: 200 };

  it("sits at the bottom with no anchor", () => {
    expect(placeCard(null, sheet, phone, true)).toEqual({ kind: "sheet", side: "bottom" });
  });

  it("sits at the bottom when the anchor is high enough", () => {
    expect(placeCard({ top: 80, left: 8, width: 374, height: 120 }, sheet, phone, true)).toEqual({
      kind: "sheet",
      side: "bottom",
    });
  });

  it("moves to the top when the anchor is in the lower part of the screen", () => {
    expect(placeCard({ top: 770, left: 8, width: 374, height: 60 }, sheet, phone, true)).toEqual({
      kind: "sheet",
      side: "top",
    });
  });
});

describe("placeCard around page content", () => {
  const anchor = { top: 100, left: 300, width: 400, height: 80 };

  it("keeps the first side with room when nothing is in the way", () => {
    expect(placeCard(anchor, card, view, false, [])).toEqual(placeCard(anchor, card, view, false));
  });

  it("moves to free space when the first side would cover other content", () => {
    // A neighbour sits right of the anchor, so the card goes to the free left side.
    const neighbour = { top: 100, left: 714, width: 340, height: 400 };
    const p = placeCard({ ...anchor, left: 400 }, card, view, false, [neighbour]);
    expect(p).toEqual({ kind: "float", top: 100, left: 400 - GAP - card.width });
  });

  it("falls back to a corner that covers nothing when no side of the anchor is free", () => {
    const wide = { top: 100, left: 20, width: 1400, height: 120 };
    const content = [wide, { top: 240, left: 20, width: 1400, height: 400 }];
    const p = placeCard(wide, card, view, false, content);
    expect(p.kind).toBe("float");
    if (p.kind === "float") {
      // The bottom strip below the content is empty: the card sits in it.
      expect(p.top).toBeGreaterThanOrEqual(640);
    }
  });
});
