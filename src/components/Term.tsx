import React from "react";
import { GLOSSARY } from "@/desk/glossary";
import css from "./Term.module.css";

const TIP_WIDTH = 280;
const GAP = 6;
const FLIP_BELOW = 140;

/**
 * Dotted-underline jargon term (a native button, so it is focusable and
 * tappable) with a glossary tooltip. Shown on hover and on
 * keyboard focus; Escape dismisses it. The tooltip is position: fixed so
 * ellipsized or overflow-hidden parents cannot clip it. Callers wrap only the
 * first occurrence of a term on a page.
 */
export function Term({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.ReactElement {
  const definition = GLOSSARY[id];
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
    </button>
  );
}
