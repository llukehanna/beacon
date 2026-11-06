import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EVIDENCE_DRAWER_CLASS } from "@/desk/firmDesk/dialogs";
import { type Command, useCommands } from "@/shell/commands";
import { isTypingTarget } from "@/shell/keys";
import { TourCard } from "./TourCard";
import { TourContext, type TourControls } from "./tourContext";
import { nextStep, prevStep, stepFromSearch, stepSearch } from "./tourModel";
import { TOUR_STEPS } from "./tourSteps";
import { useAnchor } from "./useAnchor";

const NARROW_QUERY = "(max-width: 899px)";

/** The page the tour opens on. */
const FIRST = TOUR_STEPS[0];

function useNarrow(): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(NARROW_QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

/**
 * True while a dialog other than the tour's own card (the palette, the shortcut list) is open. The
 * Desk's evidence drawer does not count: a stop opens it on narrow screens.
 */
function foreignDialogOpen(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"]')).some(
    (d) =>
      !d.hasAttribute("data-tour-card") &&
      d.closest(`.${EVIDENCE_DRAWER_CLASS}`) === null &&
      d.querySelector(`.${EVIDENCE_DRAWER_CLASS}`) === null,
  );
}

/**
 * The guided tour. Its whole state is the `?tour=<1-6>` parameter of the current URL, so Back,
 * Forward and a reload land on the same stop, and leaving by any other link ends it. Each stop
 * navigates to its route, waits for its anchor and shows a card beside it. The tour only reads and
 * highlights: nothing it does writes data.
 */
export function TourProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const index = stepFromSearch(search);
  const step = index === null ? null : TOUR_STEPS[index];
  const anchor = useAnchor(step, narrow);

  // Where focus was when the tour opened, to give back on close.
  const openerRef = React.useRef<Element | null>(null);
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (index !== null && !wasRunning.current) {
      openerRef.current = document.activeElement;
    }
    wasRunning.current = index !== null;
  }, [index]);

  // A stop belongs to its route: a hand-edited URL is sent to the right page.
  React.useEffect(() => {
    if (step !== null && index !== null && pathname !== step.route) {
      navigate({ pathname: step.route, search: stepSearch("", index) }, { replace: true });
    }
  }, [step, index, pathname, navigate]);

  const goTo = React.useCallback(
    (to: number): void => {
      const target = TOUR_STEPS[to];
      navigate(
        target.route === pathname
          ? { pathname, search: stepSearch(search, to) }
          : { pathname: target.route, search: stepSearch("", to) },
      );
    },
    [navigate, pathname, search],
  );

  const start = React.useCallback((): void => {
    navigate({ pathname: FIRST.route, search: stepSearch("", 0) });
  }, [navigate]);

  const close = React.useCallback((): void => {
    navigate({ pathname, search: stepSearch(search, null) }, { replace: true });
    const opener = openerRef.current;
    // After the card has gone: the opener if it is still on the page, else the main area.
    window.setTimeout(() => {
      const target =
        opener instanceof HTMLElement && opener.isConnected && opener !== document.body
          ? opener
          : document.getElementById("main");
      target?.focus({ preventScroll: true });
    }, 0);
  }, [navigate, pathname, search]);

  const next = index === null ? null : nextStep(index);
  const prev = index === null ? null : prevStep(index);
  const nextRef = React.useRef(next);
  nextRef.current = next;
  const prevRef = React.useRef(prev);
  prevRef.current = prev;
  const goRef = React.useRef(goTo);
  goRef.current = goTo;
  const closeRef = React.useRef(close);
  closeRef.current = close;

  const running = index !== null;
  React.useEffect(() => {
    if (!running) {
      return undefined;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        isTypingTarget(e.target as Element | null) ||
        foreignDialogOpen()
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "ArrowRight" && nextRef.current !== null) {
        e.preventDefault();
        goRef.current(nextRef.current);
      } else if (e.key === "ArrowLeft" && prevRef.current !== null) {
        e.preventDefault();
        goRef.current(prevRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  const controls = React.useMemo<TourControls>(() => ({ start }), [start]);
  const commands = React.useMemo<Command[]>(
    () => [{ id: "tour:start", label: "Take the tour", group: "Actions", run: start }],
    [start],
  );
  useCommands(commands);

  return (
    <TourContext.Provider value={controls}>
      {children}
      {step !== null && index !== null && pathname === step.route && anchor.phase !== "seeking" && (
        <TourCard
          step={step}
          index={index}
          total={TOUR_STEPS.length}
          rect={anchor.rect}
          narrow={narrow}
          onPrev={prev === null ? null : () => goTo(prev)}
          onNext={next === null ? null : () => goTo(next)}
          onClose={close}
        />
      )}
    </TourContext.Provider>
  );
}
