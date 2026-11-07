import React from "react";
import { GLOSSARY } from "@/desk/glossary";
import css from "./Term.module.css";

const TIP_WIDTH = 280;
const GAP = 6;
const FLIP_BELOW = 200;

/**
 * Dotted-underline jargon term (a native button, so it is focusable and
 * tappable) with a glossary tooltip. Shown on hover, keyboard focus and
 * click/tap; Escape, blur and mouseleave dismiss it. The tooltip is a
 * sibling of the button, not a child, so it is not part of the button's
 * accessible name (it is linked through aria-describedby instead). The tooltip is position: fixed so
 * ellipsized or overflow-hidden parents cannot clip it. Callers wrap only the
 * first occurrence of a term on a page.
 */
export function Term({
  id,
  definition: given,
  children,
}: {
  id: string;
  /** A definition worded for this place (it names this firm's cut-off, say), in place of the glossary's. */
  definition?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const definition = given ?? GLOSSARY[id];
  const tipId = React.useId();
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number } | null>(
    null,
  );

  if (definition === undefined) {
    return <>{children}</>;
  }

  const show = (): void => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - TIP_WIDTH - 8));
    // Flip above the term when there is no room for the tooltip below it.
    setPos(
      window.innerHeight - r.bottom < FLIP_BELOW
        ? { left, bottom: window.innerHeight - r.top + GAP }
        : { left, top: r.bottom + GAP },
    );
  };
  const hide = (): void => setPos(null);

  return (
    <>
      <button
        type="button"
        ref={ref}
        className={css.term}
        aria-describedby={pos !== null ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onClick={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            hide();
          }
        }}
      >
        {children}
      </button>
      {pos !== null && (
        <span
          id={tipId}
          role="tooltip"
          className={css.tip}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
        >
          {definition}
        </span>
      )}
    </>
  );
}
