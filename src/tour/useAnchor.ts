import React from "react";
import { type Box } from "./placement";
import { resolveAnchor } from "./tourModel";
import { type TourStep } from "./tourSteps";

/** How long a stop waits for its anchor (a route's data may still be loading) before it gives up. */
export const ANCHOR_WAIT_MS = 4000;

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
          el.scrollIntoView?.({ block: narrow ? "start" : "nearest", inline: "nearest" });
        }
        const box: Box = { top: r.top, left: r.left, width: r.width, height: r.height };
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
