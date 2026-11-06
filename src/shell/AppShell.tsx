import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Drawer } from "@blueprintjs/core";
import styles from "./AppShell.module.css";
import CommandPalette from "./CommandPalette";
import ShortcutsOverlay from "./ShortcutsOverlay";
import Sidebar from "./Sidebar";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";
import { SidebarSlotContext } from "./sidebarSlot";
import { useGoKeys } from "./useGoKeys";
import { usePaletteKeys } from "./usePaletteKeys";
import { useShellCommands } from "./useShellCommands";
import { useShellCounts } from "./useShellData";

const NARROW_QUERY = "(max-width: 899px)";

/** True under 900 px, where the sidebar becomes a drawer. */
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
 * The frame every screen renders inside: sidebar, top bar, status bar and the global keyboard
 * navigation. Screens render in the main area through the router's outlet.
 */
export default function AppShell(): React.ReactElement {
  const narrow = useNarrow();
  const { pathname, search } = useLocation();
  const counts = useShellCounts();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // The firm list is fetched the first time the palette opens, not on every screen.
  const [paletteUsed, setPaletteUsed] = React.useState(false);
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);

  const openHelp = React.useCallback(() => setHelpOpen(true), []);
  useGoKeys(openHelp);
  const { commands, firmCount, firmStatus } = useShellCommands({
    loadFirms: paletteUsed,
    onHelp: openHelp,
  });
  const setPalette = React.useCallback((open: boolean) => {
    setPaletteOpen(open);
    if (open) {
      setPaletteUsed(true);
    }
  }, []);
  usePaletteKeys(paletteOpen, setPalette);

  // Picking a route, or a firm in the queue, closes the drawer; widening the window does too.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, search, narrow]);

  const focusMain = (e: React.MouseEvent): void => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  };

  const sidebar = <Sidebar counts={counts} slotRef={setSlot} />;

  return (
    <SidebarSlotContext.Provider value={slot}>
      <div className={styles.shell}>
        <a href="#main" className={styles.skip} onClick={focusMain}>
          Skip to content
        </a>
        {narrow ? (
          <Drawer
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            position="left"
            size={288}
            title="Navigation"
            className={`${styles.drawer} bp6-dark`}
          >
            {sidebar}
          </Drawer>
        ) : (
          <aside className={styles.side} aria-label="Workspace">
            {sidebar}
          </aside>
        )}
        <div className={styles.column}>
          <TopBar
            showMenu={narrow}
            menuOpen={drawerOpen}
            onMenu={() => setDrawerOpen(true)}
            onSearch={() => setPalette(true)}
            onSearchIntent={() => setPaletteUsed(true)}
          />
          <div id="main" tabIndex={-1} className={styles.main}>
            <Outlet />
          </div>
        </div>
        <StatusBar counts={counts} />
        <CommandPalette
          commands={commands}
          firmCount={firmCount}
          firmStatus={firmStatus}
          isOpen={paletteOpen}
          onClose={() => setPalette(false)}
        />
        <ShortcutsOverlay isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </SidebarSlotContext.Provider>
  );
}
