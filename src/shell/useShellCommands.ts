import React from "react";
import { useNavigate } from "react-router-dom";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, Mandate } from "@/data/ontology";
import { type Command, usePageCommands } from "./commands";
import { NAV_ITEMS } from "./keys";

/** Where the firm list stands: not asked for yet, on its way, failed, or available. */
export type FirmStatus = "idle" | "loading" | "error" | "ready";

/**
 * Every command the palette can offer: routes, active mandates, shell actions, the actions screens
 * register, and the firm list. Firms and mandates are only fetched once `loadFirms` is true (the
 * first time the palette opens), so the shell does not load either list on screens that never need
 * it. The firm query is the one the Desk makes, so opening the palette there costs nothing extra.
 */
export function useShellCommands({
  loadFirms,
  onHelp,
}: {
  loadFirms: boolean;
  onHelp: () => void;
}): { commands: Command[]; firmCount: number | undefined; firmStatus: FirmStatus } {
  const navigate = useNavigate();
  const { data: mandateData } = useOsdkObjects(Mandate, {
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
    enabled: loadFirms,
  });
  const { data: firmData, error: firmError } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
    enabled: loadFirms,
  });
  const pageCommands = usePageCommands();

  const helpRef = React.useRef(onHelp);
  helpRef.current = onHelp;

  const firms = React.useMemo<Command[]>(
    () =>
      (firmData ?? [])
        .filter((f) => (f.firmName ?? "").trim() !== "")
        .map((f) => ({
          id: `firm:${f.firmId}`,
          label: f.firmName as string,
          group: "Firms" as const,
          hint: f.hqCountry ?? undefined,
          run: () => navigate(`/desk?firmId=${encodeURIComponent(f.firmId)}`),
        })),
    [firmData, navigate],
  );

  const mandates = React.useMemo<Command[]>(
    () =>
      (mandateData ?? [])
        // active === false retires a mandate; null predates the flag and still counts.
        .filter((m) => m.active !== false)
        .map((m) => ({
          id: `mandate:${m.mandateId}`,
          // Named the way the mandate page names it: intent statement, then title.
          label: (m.intentStatement ?? "").trim() || (m.title ?? "").trim() || m.mandateId,
          group: "Mandates" as const,
          // The mandate's own page; opening it changes no stored state (only its Run action does).
          run: () => navigate(`/search/${encodeURIComponent(m.mandateId)}`),
        })),
    [mandateData, navigate],
  );

  const routes = React.useMemo<Command[]>(
    () =>
      NAV_ITEMS.map((n) => ({
        id: `go:${n.to}`,
        label: n.label,
        group: "Go to" as const,
        hint: `G ${n.key.toUpperCase()}`,
        run: () => navigate(n.to),
      })),
    [navigate],
  );

  const actions = React.useMemo<Command[]>(
    () => [
      {
        id: "action:shortcuts",
        label: "Show keyboard shortcuts",
        group: "Actions" as const,
        hint: "?",
        run: () => helpRef.current(),
      },
    ],
    [],
  );

  const commands = React.useMemo(
    () => [...pageCommands, ...actions, ...routes, ...mandates, ...firms],
    [pageCommands, actions, routes, mandates, firms],
  );
  let firmStatus: FirmStatus = "idle";
  if (loadFirms) {
    firmStatus = firmData !== undefined ? "ready" : firmError !== undefined ? "error" : "loading";
  }
  return {
    commands,
    firmCount: firmStatus === "ready" ? firms.length : undefined,
    firmStatus,
  };
}
