import React from "react";
import { Link } from "react-router-dom";
import { Button, Kbd } from "@/ui";
import styles from "./TourCard.module.css";
import { type Box, type Size, placeCard } from "./placement";
import { type TourStep } from "./tourSteps";

/** What the card assumes about its own size until it has been measured. */
const GUESS: Size = { width: 340, height: 230 };

/**
 * One stop of the tour: a spotlight outline around the anchor and a card beside it (a sheet on
 * the top or bottom edge under 900 px). Focus moves to the card when it appears. It is a
 * non-modal dialog, so the app's single-key shortcuts stand down while it is up and the only
 * keys it answers are ←, → and Esc.
 */
export function TourCard({
  step,
  index,
  total,
  rect,
  narrow,
  onPrev,
  onNext,
  onClose,
}: {
  step: TourStep;
  index: number;
  total: number;
  /** The anchor's rectangle, or null for a centred card. */
  rect: Box | null;
  narrow: boolean;
  onPrev: (() => void) | null;
  /** Null on the last stop, which offers Done and the closing links instead. */
  onNext: (() => void) | null;
  onClose: () => void;
}): React.ReactElement {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<Size>(GUESS);
  const [view, setView] = React.useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const last = onNext === null;

  React.useLayoutEffect(() => {
    const onResize = (): void => setView({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Measured after every render that could change it, before the browser paints.
  React.useLayoutEffect(() => {
    const el = cardRef.current;
    if (el === null) {
      return;
    }
    const r = el.getBoundingClientRect();
    setSize((prev) =>
      Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
        ? prev
        : { width: r.width, height: r.height },
    );
  }, [step.id, last, narrow, view.width]);

  // Each stop takes focus, so the keyboard continues from the card.
  React.useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [step.id]);

  const placement = placeCard(rect, size, view, narrow);
  const position: React.CSSProperties =
    placement.kind === "float" ? { top: placement.top, left: placement.left } : {};

  return (
    <>
      {rect !== null && (
        <div
          className={styles.spotlight}
          data-tour-spotlight={step.id}
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className={styles.card}
        data-tour-card={step.id}
        data-placement={placement.kind === "sheet" ? `sheet-${placement.side}` : "float"}
        style={position}
      >
        <div className={styles.top}>
          <span className={styles.count} aria-label={`Step ${index + 1} of ${total}`}>
            {index + 1} of {total}
          </span>
          <Button variant="ghost" onClick={onClose} aria-label="Close tour" title="Close (Esc)">
            <span aria-hidden="true">✕</span>
          </Button>
        </div>
        <h2 id="tour-title" className={styles.title}>
          {step.title}
        </h2>
        <p id="tour-body" className={styles.body}>
          {step.body}
        </p>
        {last && (
          <p className={styles.links}>
            <Link to="/accuracy">See how accurate it is</Link>
            <Link to="/about">About Beacon</Link>
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onPrev ?? undefined} disabled={onPrev === null}>
            <Kbd>←</Kbd> Back
          </Button>
          {last ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <Button variant="primary" onClick={onNext ?? undefined}>
              Next <Kbd>→</Kbd>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
