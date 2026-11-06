import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "@blueprintjs/icons";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, ReviewDecision } from "@/data/ontology";
import { useMediaQuery } from "@/desk/firmDesk/useMediaQuery";
import {
  DEFAULT_SORT,
  type PipelineSort,
  nextSort,
  rejectDecisionByFirm,
} from "@/desk/pipelineRows";
import { type Command, useCommands } from "@/shell/commands";
import { Button, ButtonLink, EmptyState, SidePanel } from "@/ui";
import { PASSED } from "../../shared/vocab";
import { Filters } from "./Filters";
import { FirmDetail } from "./FirmDetail";
import { FirmList } from "./FirmList";
import styles from "./PipelinePage.module.css";
import { StageTabs } from "./StageTabs";
import {
  type FirmView,
  NO_PROFILE_FILTER,
  type ProfileFilter,
  type StageFilter,
  buildRows,
  hasProfileFilter,
  isOut,
  lastActivityByFirm,
  rowsForStage,
  sortSummary,
  stageCounts,
  stageFromParam,
  stageToParam,
} from "./pipelineModel";

/**
 * Pipeline: every firm and where it stands. The stage tabs filter by funnel stage (the page reads
 * `?stage=` so Home's funnel can link straight to one), search and the profile filters narrow
 * the list, and selecting a firm opens its detail beside the list, or in a drawer under 1280 px.
 */
export default function PipelinePage(): React.ReactElement {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });

  const wide = useMediaQuery("(min-width: 1280px)");
  const cards = useMediaQuery("(max-width: 899px)");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [query, setQuery] = React.useState("");
  const [profile, setProfile] = React.useState<ProfileFilter>(NO_PROFILE_FILTER);
  const [sort, setSort] = React.useState<PipelineSort>(DEFAULT_SORT);

  const stage = stageFromParam(params.get("stage"));
  const setStage = React.useCallback(
    (next: StageFilter) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          const value = stageToParam(next);
          if (value === null) {
            out.delete("stage");
          } else {
            out.set("stage", value);
          }
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const firms = React.useMemo(() => (data ?? []) as unknown as FirmView[], [data]);
  // Newest reject decision per firm: the pass reason, and the score and tier the firm was passed
  // at. Decisions are ordered newest first.
  const rejectByFirm = React.useMemo(
    () => rejectDecisionByFirm(decisionsData ?? []),
    [decisionsData],
  );
  const activityByFirm = React.useMemo(
    () => lastActivityByFirm(decisionsData ?? []),
    [decisionsData],
  );

  // Search and profile filters decide which firms are counted; the stage tab then picks among them.
  const rows = React.useMemo(
    () => buildRows({ firms, query, profile, sort, rejectByFirm, activityByFirm }),
    [firms, query, profile, sort, rejectByFirm, activityByFirm],
  );
  const counts = React.useMemo(() => stageCounts(rows), [rows]);
  const visibleRows = React.useMemo(() => rowsForStage(rows, stage), [rows, stage]);
  const selectedRow = React.useMemo(
    () => visibleRows.find((r) => r.firm.firmId === selectedId),
    [visibleRows, selectedId],
  );

  const loading = isLoading && firms.length === 0;
  const narrowed = query.trim() !== "" || hasProfileFilter(profile);
  const clearFilters = React.useCallback(() => {
    setQuery("");
    setProfile(NO_PROFILE_FILTER);
    setStage("all");
  }, [setStage]);

  const selectedFirmId = selectedRow?.firm.firmId;
  const selectedName = selectedRow?.firm.firmName ?? selectedFirmId;
  const selectedOut = selectedRow === undefined ? true : isOut(selectedRow);
  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: "pipeline:new-search",
        label: "New search",
        group: "Actions",
        run: () => navigate("/mandate"),
      },
      ...(selectedFirmId === undefined || selectedOut
        ? []
        : [
            {
              id: "pipeline:open-in-desk",
              label: `Open ${selectedName} in the desk`,
              group: "Actions" as const,
              run: () => navigate(`/desk?firmId=${encodeURIComponent(selectedFirmId)}`),
            },
          ]),
      ...(stage === PASSED
        ? []
        : [
            {
              id: "pipeline:show-passed",
              label: "Show passed firms",
              group: "Actions" as const,
              run: () => setStage(PASSED),
            },
          ]),
      ...(stage === "all"
        ? []
        : [
            {
              id: "pipeline:show-all",
              label: "Show every stage",
              group: "Actions" as const,
              run: () => setStage("all"),
            },
          ]),
      ...(narrowed || stage !== "all"
        ? [
            {
              id: "pipeline:clear-filters",
              label: "Clear pipeline filters",
              group: "Actions" as const,
              run: clearFilters,
            },
          ]
        : []),
    ],
    [navigate, selectedFirmId, selectedName, selectedOut, stage, narrowed, setStage, clearFilters],
  );
  useCommands(commands);

  const now = Date.now();
  const empty =
    firms.length === 0 ? (
      <EmptyState
        title="No firms yet"
        body="Run a search from a mandate and the firms it finds will be listed here, stage by stage."
        action={<ButtonLink to="/mandate">Open Mandates</ButtonLink>}
      />
    ) : narrowed ? (
      <EmptyState
        title="No firms match"
        body="Try a broader sector or geography, or clear the filters."
        action={<Button onClick={clearFilters}>Clear filters</Button>}
      />
    ) : (
      <EmptyState
        title={stage === PASSED ? "No firms passed yet" : `No firms at ${stage}`}
        body="Firms move between stages as they are decided on the Desk."
        action={<Button onClick={() => setStage("all")}>Show every stage</Button>}
      />
    );

  const panelOpen = selectedRow !== undefined;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h1 className={styles.title}>Working set</h1>
          <p className={styles.sub}>
            {loading
              ? "Loading firms…"
              : `${visibleRows.length} of ${firms.length} firms · ${sortSummary(sort)}${panelOpen ? "" : " · select a firm for details"}`}
          </p>
        </div>
        <div className={styles.tools}>
          <div className={styles.search}>
            <Search className={styles.searchIcon} size={14} aria-hidden="true" />
            <input
              className={styles.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search firms, sectors, HQ…"
              aria-label="Search firms"
            />
          </div>
          <ButtonLink to="/mandate" variant="primary">
            New search
          </ButtonLink>
        </div>
      </header>
      {error !== undefined && error !== null && (
        <p className={styles.error} role="alert">
          {String(error)}
        </p>
      )}
      <div className={styles.layout} data-panel={wide && panelOpen ? "column" : undefined}>
        <div className={styles.col}>
          <div ref={scrollRef} className={styles.scroll}>
            <StageTabs value={stage} counts={counts} loading={loading} onChange={setStage} />
            <Filters profile={profile} onProfile={setProfile} sort={sort} onSort={setSort} />
            <FirmList
              rows={visibleRows}
              loading={isLoading}
              empty={empty}
              cards={cards}
              selectedId={selectedId}
              onSelect={setSelectedId}
              scrollRef={scrollRef}
              sort={sort}
              onSort={(key) => setSort((current) => nextSort(current, key))}
              now={now}
            />
          </div>
        </div>
        <SidePanel
          open={panelOpen}
          asDrawer={!wide}
          label="Firm detail"
          title={selectedName ?? "Firm"}
          onClose={() => setSelectedId(undefined)}
        >
          {selectedRow !== undefined && (
            <FirmDetail
              key={selectedFirmId}
              row={selectedRow}
              showName={wide}
              now={now}
              onClose={wide ? () => setSelectedId(undefined) : undefined}
            />
          )}
        </SidePanel>
      </div>
    </div>
  );
}
