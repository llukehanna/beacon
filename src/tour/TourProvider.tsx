import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOsdkQuery } from "@/data/hooks";
import { EVIDENCE_DRAWER_CLASS } from "@/desk/firmDesk/dialogs";
import { type Command, useCommands } from "@/shell/commands";
import { isTypingTarget } from "@/shell/keys";
import { TOUR_FIRM_ID } from "../../shared/showcaseFirms";
import { TourCard } from "./TourCard";
import { TourContext, type TourControls } from "./tourContext";
import {
  arrivalSearch,
  nextStep,
  prevStep,
  stepFromSearch,
  stepSearch,
  withStepParams,
} from "./tourModel";
import { TOUR_STEPS } from "./tourSteps";
import { SHEET_RESERVE, useAnchor } from "./useAnchor";

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
  const running = index !== null;

  // The Desk stops' firm, asked for while the tour runs. Until it arrives a Desk stop that still
  // needs it waits; if the question fails, the seeded tour firm stands in.
  const tourFirm = useOsdkQuery("tourFirm", undefined, { enabled: running });
  const firmId = tourFirm.data?.firmId ?? (tourFirm.error ? TOUR_FIRM_ID : undefined);

  // Where focus was when the tour opened, to give back on close.
  const openerRef = React.useRef<Element | null>(null);
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (index !== null && !wasRunning.current) {
      openerRef.current = document.activeElement;
    }
    wasRunning.current = index !== null;
  }, [index]);

  // A stop belongs to its route: a hand-edited URL is sent to the right page, with what the stop
  // needs (the Desk's firm) filled in where the URL leaves it out.
  React.useEffect(() => {
    if (step === null || index === null) {
      return;
    }
    const needsFirm =
      step.onFirm === true &&
      (pathname !== step.route || !new URLSearchParams(search).has("firmId"));
    if (needsFirm && firmId === undefined) {
      return;
    }
    const firm = firmId ?? TOUR_FIRM_ID;
    if (pathname !== step.route) {
      navigate(
        { pathname: step.route, search: arrivalSearch(step, index, firm) },
        { replace: true },
      );
      return;
    }
    const filled = withStepParams(search, step, firm);
    if (filled !== null) {
      navigate({ pathname, search: filled }, { replace: true });
    }
  }, [step, index, pathname, search, navigate, firmId]);

  const goTo = React.useCallback(
    (to: number): void => {
      const target = TOUR_STEPS[to];
      navigate(
        target.route === pathname
          ? { pathname, search: stepSearch(search, to) }
          : { pathname: target.route, search: arrivalSearch(target, to, firmId ?? TOUR_FIRM_ID) },
      );
    },
    [navigate, pathname, search, firmId],
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

  // A bottom sheet covers the foot of the screen, so scrollers that end in an anchor (the Desk's
  // decision bar) get room to scroll it above the sheet.
  const sheetUp = running && narrow;
  React.useEffect(() => {
    if (!sheetUp) {
      return undefined;
    }
    const root = document.documentElement;
    root.style.setProperty("--tour-sheet-space", `${SHEET_RESERVE}px`);
    return () => {
      root.style.removeProperty("--tour-sheet-space");
    };
  }, [sheetUp]);

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
