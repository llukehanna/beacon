import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Filter,
  Flag,
  Home,
  ListDetailView,
  Properties,
  TickCircle,
  TimelineLineChart,
} from "@blueprintjs/icons";
import styles from "./Sidebar.module.css";
import { NAV_ITEMS, type NavItem, navItemFor } from "./keys";
import { mandateSubtitle } from "./status";
import { type ShellCounts, useDeskScope } from "./useShellData";

const ICONS: Record<NavItem["to"], typeof Home> = {
  "/": Home,
  "/desk": ListDetailView,
  "/pipeline": Filter,
  "/review": TickCircle,
  "/rules": Properties,
  "/accuracy": TimelineLineChart,
  "/mandate": Flag,
};

const COUNT_TITLE: Partial<Record<NavItem["to"], string>> = {
  "/desk": "Open firms: discovered or being screened",
  "/review": "Drift events waiting on a decision",
};

function countFor(to: NavItem["to"], counts: ShellCounts): number | undefined {
  if (to === "/desk") {
    return counts.open;
  }
  return to === "/review" ? counts.review : undefined;
}

/**
 * Workspace rail: logo, workspace name and mandate line, the seven routes with live counts, and
 * the slot a screen can fill (the Desk puts its firm queue there). Rendered in the fixed rail on
 * wide screens and in a drawer on narrow ones.
 */
export default function Sidebar({
  counts,
  slotRef,
}: {
  counts: ShellCounts;
  slotRef: (el: HTMLDivElement | null) => void;
}): React.ReactElement {
  const { pathname } = useLocation();
  const current = navItemFor(pathname);
  const { mandate } = useDeskScope(pathname === "/desk");
  const subtitle = mandateSubtitle(mandate, counts.activeMandates);

  return (
    <div className={styles.rail}>
      <div className={styles.workspace}>
        <span className={styles.logo} aria-hidden="true" />
        <div className={styles.name}>
          <b>Beacon</b>
          <span title={subtitle ?? undefined}>{subtitle ?? " "}</span>
        </div>
      </div>
      <nav aria-label="Primary" className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.to];
          const count = countFor(item.to, counts);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={styles.item}
              aria-current={current?.to === item.to ? "page" : undefined}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
              {count !== undefined && count > 0 && (
                <span className={styles.count} title={COUNT_TITLE[item.to]}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div ref={slotRef} className={styles.slot} />
    </div>
  );
}
