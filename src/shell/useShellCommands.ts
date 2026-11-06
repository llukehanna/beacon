import React from "react";
import { useNavigate } from "react-router-dom";
import { useOsdkObjects, useOsdkQuery } from "@/data/hooks";
import { Firm } from "@/data/ontology";
import type { HomeSummary } from "../../shared/summaries";
import { type Command, usePageCommands } from "./commands";
import { NAV_ITEMS } from "./keys";

interface FirmRow {
  firmId: string;
  firmName?: string | null;
  hqCountry?: string | null;
}

/**
 * Every command the palette can offer: routes, active mandates, shell actions, the actions screens
 * register, and the firm list. Firms are only fetched once `loadFirms` is true (the first time the
 * palette opens), so the shell does not load the whole list on screens that never need it. The
 * firm query is the one the Desk makes, so opening the palette there costs nothing extra.
 */
export function useShellCommands({
  loadFirms,
  onHelp,
}: {
  loadFirms: boolean;
  onHelp: () => void;
}): { commands: Command[]; firmCount: number | undefined } {
  const navigate = useNavigate();
  const { data: summary } = useOsdkQuery<HomeSummary>("homeSummary");
  const { data: firmData } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
    enabled: loadFirms,
  });
  const pageCommands = usePageCommands();

  const helpRef = React.useRef(onHelp);
  helpRef.current = onHelp;

  const firms = React.useMemo<Command[]>(
    () =>
      ((firmData ?? []) as unknown as FirmRow[])
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
      (summary?.mandates ?? []).map((m) => ({
        id: `mandate:${m.mandateId}`,
        label: (m.title ?? "").trim() || (m.intentStatement ?? "").trim() || m.mandateId,
        group: "Mandates" as const,
        // The mandate page lists every mandate; opening one changes no stored state.
        run: () => navigate("/mandate"),
      })),
    [summary, navigate],
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
  return { commands, firmCount: loadFirms && firmData !== undefined ? firms.length : undefined };
}
