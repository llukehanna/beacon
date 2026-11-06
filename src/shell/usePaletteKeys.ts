import React from "react";
import { isTypingTarget, modalIsOpen } from "./keys";

/**
 * Opens the palette with ⌘K or Ctrl+K from anywhere (the browser's own use of the chord is
 * suppressed) and with `/` when no text field has focus. Leaves the keys alone while another dialog
 * is open, so the demo reset confirmation and the shortcuts list keep the keyboard.
 */
export function usePaletteKeys(isOpen: boolean, setOpen: (open: boolean) => void): void {
  const openRef = React.useRef(isOpen);
  openRef.current = isOpen;
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) {
        return;
      }
      const chord = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
      const slash =
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTypingTarget(e.target as Element | null);
      if (!chord && !slash) {
        return;
      }
      if (openRef.current) {
        // Already open: the chord closes it, and `/` is text for the search box.
        if (chord) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (modalIsOpen()) {
        return;
      }
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [setOpen]);
}
