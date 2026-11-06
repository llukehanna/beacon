import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Search } from "@blueprintjs/icons";
import { Kbd } from "@/ui";
import styles from "./TopBar.module.css";
import { footerLinkFor, navItemFor } from "./keys";
import { useDeskScope } from "./useShellData";

interface Crumb {
  label: string;
  to?: string;
}

function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const onDesk = pathname === "/desk";
  const { mandate, firm } = useDeskScope(onDesk);
  const section = navItemFor(pathname);
  if (/^\/firm\/[^/]+\/tear-sheet$/.test(pathname)) {
    return [{ label: "Pipeline", to: "/pipeline" }, { label: "Tear sheet" }];
  }
  if (section === undefined) {
    const page = footerLinkFor(pathname);
    return page === undefined ? [] : [{ label: page.label }];
  }
  if (onDesk) {
    return [
      { label: section.label, to: section.to },
      ...(mandate === null ? [] : [{ label: mandate }]),
      ...(firm === null ? [] : [{ label: firm }]),
    ];
  }
  if (pathname.startsWith("/search/")) {
    return [{ label: section.label, to: section.to }, { label: "Run search" }];
  }
  return [{ label: section.label }];
}

/**
 * 48 px top bar: breadcrumbs, the search pill (opens the command palette) and, under 900 px, the button that opens the sidebar
 * drawer. There is deliberately no avatar; nothing behind one exists.
 */
export default function TopBar({
  menuOpen,
  onMenu,
  onSearch,
  onSearchIntent,
  showMenu,
}: {
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  /** Pointer or focus arrived on the pill: a chance to start loading what the palette will search. */
  onSearchIntent: () => void;
  showMenu: boolean;
}): React.ReactElement {
  const crumbs = useCrumbs();
  const { pathname } = useLocation();
  return (
    <header className={styles.top}>
      {showMenu && (
        <button
          type="button"
          className={styles.menu}
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <Menu size={16} aria-hidden="true" />
        </button>
      )}
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <ol>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${i}-${c.label}`} aria-current={last ? "page" : undefined}>
                {/* A crumb that points at this very page is not a link: one tab stop fewer. */}
                {c.to !== undefined && !last && c.to !== pathname ? (
                  <Link to={c.to}>{c.label}</Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <button
        type="button"
        className={styles.search}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={onSearch}
        onPointerEnter={onSearchIntent}
        onFocus={onSearchIntent}
      >
        <Search size={14} aria-hidden="true" />
        <span className={styles.searchText}>Search firms, run actions…</span>
        <Kbd>⌘K</Kbd>
      </button>
    </header>
  );
}
