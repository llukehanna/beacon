import { type ReactNode, type ReactPortal, createContext, useContext } from "react";
import { createPortal } from "react-dom";

/** The element under the sidebar nav that a screen can fill; null while the sidebar is closed. */
export const SidebarSlotContext = createContext<HTMLElement | null>(null);

/**
 * Puts `node` in the sidebar, under the nav, and returns it as a portal to render. The node stays
 * part of the calling screen's React tree, so its state and context survive the sidebar moving
 * between the fixed rail and the drawer. Renders nothing while the sidebar is closed.
 */
export function useSidebarSlot(node: ReactNode): ReactPortal | null {
  const target = useContext(SidebarSlotContext);
  return target === null ? null : createPortal(node, target);
}
