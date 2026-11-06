import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Search } from "@blueprintjs/icons";
import { Kbd } from "@/ui";
import styles from "./TopBar.module.css";
import { navItemFor } from "./keys";
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
  if (section === undefined) {
    return [];
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
 * 48 px top bar: breadcrumbs, the search pill and, under 900 px, the button that opens the sidebar
 * drawer. There is deliberately no avatar; nothing behind one exists.
 */
export default function TopBar({
  menuOpen,
  onMenu,
  showMenu,
}: {
  menuOpen: boolean;
  onMenu: () => void;
  showMenu: boolean;
}): React.ReactElement {
  const crumbs = useCrumbs();
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
                {c.to !== undefined && !last ? (
                  <Link to={c.to}>{c.label}</Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {/* The command palette attaches to this button. */}
      <button type="button" className={styles.search} aria-label="Search and commands">
        <Search size={14} aria-hidden="true" />
        <span className={styles.searchText}>Search firms, run actions…</span>
        <Kbd>⌘K</Kbd>
      </button>
    </header>
  );
}
