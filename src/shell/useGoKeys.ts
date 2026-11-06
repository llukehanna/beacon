import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { GO_KEYS, isGoKey, isTypingTarget, modalIsOpen } from "./keys";

/** How long G waits for the key that names the route. */
const GO_WINDOW_MS = 1500;

/**
 * Global keyboard navigation: `G` then a letter jumps to a route, `?` asks for the shortcut list.
 * Never fires while the user is typing, with a modifier held, or while a dialog is open. The
 * listener runs in the capture phase so the key that completes a jump is not also read by a
 * screen's own shortcuts (G then P must not pass a gate on the Desk).
 */
export function useGoKeys(onHelp: () => void): void {
  const navigate = useNavigate();
  const helpRef = useRef(onHelp);
  helpRef.current = onHelp;

  useEffect(() => {
    let armedAt = 0;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) {
        return;
      }
      if (isTypingTarget(e.target as Element | null) || modalIsOpen()) {
        armedAt = 0;
        return;
      }
      const key = e.key.toLowerCase();
      if (armedAt !== 0 && Date.now() - armedAt <= GO_WINDOW_MS && isGoKey(key)) {
        armedAt = 0;
        e.preventDefault();
        e.stopPropagation();
        navigate(GO_KEYS[key]);
        return;
      }
      armedAt = 0;
      if (key === "g") {
        armedAt = Date.now();
      } else if (e.key === "?") {
        e.preventDefault();
        helpRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [navigate]);
}
