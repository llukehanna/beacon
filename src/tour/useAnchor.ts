import React from "react";
import { type Box } from "./placement";
import { resolveAnchor, resolveReveal } from "./tourModel";
import { type TourStep } from "./tourSteps";

/** How long a stop waits for its anchor (a route's data may still be loading) before it gives up. */
export const ANCHOR_WAIT_MS = 4000;

/**
 * Room the narrow screen's bottom sheet takes, in px: the card (about 230) plus the gap and the
 * screen margin. Mirrored by the Desk's `--tour-sheet-space` padding and the scroll margin in
 * TourCard.module.css.
 */
export const SHEET_RESERVE = 260;

/** Where a top-aligned anchor goes on a narrow screen: just under the 48 px top bar. */
const TOP_TARGET = 60;

/** Ancestors the page can move, nearest first. Clipping ones (`overflow: hidden`) count: the app shell scrolls its content that way. */
function movers(el: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") &&
      p.scrollHeight > p.clientHeight
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Moves the element to its place on a narrow screen by scrolling the ancestors that can move,
 * nearest first, each as far as it still helps. Never uses `scrollIntoView`, which also scrolls
 * clipping ancestors past their content and once left a black page above the card.
 *
 * With `aboveSheet` the element's bottom goes just above the sheet (so the page above it still
 * shows and nothing but the sheet is below), when it fits there; otherwise its top goes just
 * under the top bar. Returns how far it moved, so a caller can tell when it has arrived.
 */
export function scrollToAnchor(reveal: Element, viewHeight: number, aboveSheet: boolean): number {
  const r = reveal.getBoundingClientRect();
  const fits = r.height + TOP_TARGET <= viewHeight - SHEET_RESERVE;
  let delta = aboveSheet && fits ? r.bottom - (viewHeight - SHEET_RESERVE) : r.top - TOP_TARGET;
  const wanted = delta;
  for (const p of movers(reveal)) {
    if (Math.abs(delta) < 1) {
      break;
    }
    const before = p.scrollTop;
    p.scrollTop += delta;
    delta -= p.scrollTop - before;
  }
  return wanted - delta;
}

/** How long the anchor must hold still before a narrow screen scrolls it again, and how often. */
const SETTLE_MS = 250;
const MAX_SETTLE_SCROLLS = 4;

export type AnchorPhase = "seeking" | "found" | "missing";

export interface AnchorState {
  /** The stop this answer is for; a render of a newer stop must not trust it. */
  stepId: string | null;
  phase: AnchorPhase;
  /** The anchor's rectangle in viewport pixels while it is found. */
  rect: Box | null;
}

const NONE: AnchorState = { stepId: null, phase: "seeking", rect: null };

function same(a: Box | null, b: Box): boolean {
  return (
    a !== null &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Finds a stop's anchor and follows it. The page is still loading when a stop opens, so this keeps
 * looking for up to {@link ANCHOR_WAIT_MS}; once found it scrolls the anchor into view once and
 * reports its rectangle again whenever it moves (scrolling, layout, a drawer sliding in). After
 * the wait the phase is "missing" and the card is shown centred; a late anchor is still picked up.
 */
export function useAnchor(step: TourStep | null, narrow: boolean): AnchorState {
  const [state, setState] = React.useState<AnchorState>(NONE);

  React.useEffect(() => {
    if (step === null) {
      setState(NONE);
      return undefined;
    }
    const stepId = step.id;
    const seeking: AnchorState = { stepId, phase: "seeking", rect: null };
    setState(seeking);
    if (step.anchor === null) {
      setState({ stepId, phase: "missing", rect: null });
      return undefined;
    }
    let began = performance.now();
    let phase: AnchorPhase = "seeking";
    let el: Element | null = null;
    let scrolledTo: Element | null = null;
    let last: Box | null = null;
    let raf = 0;
    // A page lays out after the anchor first appears (data arrives, content above it grows), so the
    // first scroll can fall short. On a narrow screen the scroll is repeated once the anchor has
    // held still, until it stops moving or a few tries have passed.
    let stableSince = performance.now();
    let placed = !narrow;
    let tries = 0;

    const tick = (): void => {
      if (el === null || !el.isConnected) {
        el = resolveAnchor(document, step);
      }
      const r = el?.getBoundingClientRect();
      if (el !== null && r !== undefined && (r.width > 0 || r.height > 0)) {
        if (scrolledTo !== el) {
          scrolledTo = el;
          // Under 900 px the card is a sheet over part of the screen, so the anchor goes to the top
          // of what is left; wider it only has to be on screen.
          if (narrow) {
            scrollToAnchor(
              resolveReveal(document, step) ?? el,
              window.innerHeight,
              step.reveal !== undefined,
            );
          } else {
            el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          }
        }
        const box: Box = { top: r.top, left: r.left, width: r.width, height: r.height };
        if (!same(last, box)) {
          stableSince = performance.now();
        } else if (!placed && performance.now() - stableSince > SETTLE_MS) {
          const moved = scrollToAnchor(
            resolveReveal(document, step) ?? el,
            window.innerHeight,
            step.reveal !== undefined,
          );
          tries++;
          stableSince = performance.now();
          placed = Math.abs(moved) < 1 || tries >= MAX_SETTLE_SCROLLS;
        }
        if (phase !== "found" || !same(last, box)) {
          phase = "found";
          last = box;
          setState({ stepId, phase, rect: box });
        }
      } else if (phase === "found") {
        // The anchor went away (the page re-rendered): look again from now.
        phase = "seeking";
        began = performance.now();
        last = null;
        el = null;
        setState(seeking);
      } else if (phase === "seeking" && performance.now() - began > ANCHOR_WAIT_MS) {
        phase = "missing";
        setState({ stepId, phase, rect: null });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, narrow]);

  // Until the effect has caught up with a new stop, it is still seeking.
  return state.stepId === (step?.id ?? null) ? state : NONE;
}
