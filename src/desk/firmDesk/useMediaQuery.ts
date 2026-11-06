import React from "react";

/** Whether a CSS media query matches, following it as the window resizes. */
export function useMediaQuery(query: string): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
