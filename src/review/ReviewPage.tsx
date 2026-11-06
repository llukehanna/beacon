import React from "react";
import { Term } from "@/components/Term";
import { useOsdkObjects } from "@/data/hooks";
import { DriftEvent, Firm, ReviewDecision } from "@/data/ontology";
import { useMediaQuery } from "@/desk/firmDesk/useMediaQuery";
import { type Command, useCommands } from "@/shell/commands";
import { EmptyState, SidePanel } from "@/ui";
import { DriftDetail } from "./DriftDetail";
import { DriftList } from "./DriftList";
import styles from "./ReviewPage.module.css";
import {
  type DriftItem,
  type DriftLike,
  type FirmLike,
  buildDriftItems,
  driftRow,
} from "./driftModel";

/**
 * Review: the drift queue. Firms that moved since the analyst decided on them, each with the
 * reason it surfaced; selecting one opens its detail and decisions beside the list, or in a drawer
 * under 1280 px.
 */
export default function ReviewPage(): React.ReactElement {
  const {
    data: driftData,
    isLoading: driftLoading,
    error: driftError,
  } = useOsdkObjects(DriftEvent, {
    orderBy: { detectedAt: "desc" },
    autoFetchMore: true,
  });
  const { data: firmsData } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });

  const wide = useMediaQuery("(min-width: 1280px)");
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);

  const drifts = React.useMemo(() => (driftData ?? []) as unknown as DriftLike[], [driftData]);
  const { open, resolved } = React.useMemo(
    () => buildDriftItems(drifts, (firmsData ?? []) as unknown as FirmLike[], decisionsData ?? []),
    [drifts, firmsData, decisionsData],
  );

  const now = Date.now();
  const openRows = open.map((i) => driftRow(i, now));
  const resolvedRows = resolved.map((i) => driftRow(i, now));

  // With room for a column the first open event is selected, so the panel is never empty.
  const byId = React.useMemo(
    () => new Map<string, DriftItem>([...open, ...resolved].map((i) => [i.drift.driftEventId, i])),
    [open, resolved],
  );
  const selected =
    (selectedId === undefined ? undefined : byId.get(selectedId)) ?? (wide ? open[0] : undefined);
  const firstOpenId = open[0]?.drift.driftEventId;
  React.useEffect(() => {
    if (wide && (selectedId === undefined || !byId.has(selectedId)) && firstOpenId !== undefined) {
      setSelectedId(firstOpenId);
    }
  }, [wide, selectedId, byId, firstOpenId]);

  const selectedKey = selected?.drift.driftEventId;
  const commands = React.useMemo<Command[]>(() => {
    if (open.length === 0) {
      return [];
    }
    return [
      {
        id: "review:next",
        label: "Review next drift item",
        group: "Actions",
        run: () => {
          const at = open.findIndex((i) => i.drift.driftEventId === selectedKey);
          setSelectedId(open[(at + 1) % open.length].drift.driftEventId);
        },
      },
    ];
  }, [open, selectedKey]);
  useCommands(commands);

  const total = open.length;
  const loading = driftLoading && drifts.length === 0;
  const panelOpen = selected !== undefined;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>
          <Term id="Drift">Drift</Term> queue
        </h1>
        <p className={styles.sub}>
          {loading
            ? "Loading drift events…"
            : `${total} firm${total === 1 ? "" : "s"} ha${total === 1 ? "s" : "ve"} moved since qualification${
                resolved.length > 0 ? ` · ${resolved.length} resolved` : ""
              }`}
        </p>
      </header>
      {driftError !== undefined && driftError !== null && (
        <p className={styles.error} role="alert">
          {String(driftError)}
        </p>
      )}
      <div className={styles.layout} data-panel={wide && panelOpen ? "column" : undefined}>
        <main className={styles.scroll}>
          {!driftLoading && drifts.length === 0 ? (
            <EmptyState
              title="No firms have moved since qualification"
              body="Beacon watches for score-changing updates on firms you've already passed. When a stale reason is invalidated, it surfaces here."
            />
          ) : (
            <DriftList
              open={openRows}
              resolved={resolvedRows}
              selectedId={selected?.drift.driftEventId}
              onSelect={setSelectedId}
              loading={loading}
            />
          )}
        </main>
        <SidePanel
          open={panelOpen}
          asDrawer={!wide}
          label="Drift detail"
          title={selected?.firmName ?? "Drift"}
          onClose={() => setSelectedId(undefined)}
        >
          {selected !== undefined && (
            <DriftDetail
              // A new event starts from a clean slate (open note, errors, lookalikes).
              key={selected.drift.driftEventId}
              item={selected}
              showName={wide}
              now={now}
            />
          )}
        </SidePanel>
      </div>
    </div>
  );
}
