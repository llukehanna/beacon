import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "@/data/adapter";
import { useLinks, useOsdkObjects } from "@/data/hooks";
import { Firm, Mandate, ResearchFinding, ReviewDecision, Search } from "@/data/ontology";
import { ExportMenu } from "@/export/ExportMenu";
import { type Command, useCommands } from "@/shell/commands";
import { useSidebarSlot } from "@/shell/sidebarSlot";
import { RetryNotice } from "@/ui";
import { AGENT } from "../../../shared/vocab";
import { agentRunFirmIds, defaultDeskFirmId } from "../deskDefaults";
import { deskPanelState } from "../deskPanelState";
import { orderEnrichmentQueue, toQueueFirm } from "../queue";
import styles from "./DeskPage.module.css";
import {
  EmptyQueue,
  FirmNotFound,
  FirmNotInSearch,
  FirmSkeleton,
  LoadFailed,
  PickAFirm,
  SearchEmpty,
} from "./DeskStates";
import { EnrichmentPanel } from "./EnrichmentPanel";
import { type QueueRun, QueueSidebar } from "./QueueSidebar";
import { SearchFilterBar } from "./SearchFilterBar";
import { type RediscoveryInfo, searchLabel } from "./deskModel";
import { type FindingCounts, findingCountsByFirm } from "./queueState";
import { useQueueFilters } from "./useQueueFilters";
import { useScreeningRules } from "./useScreeningRules";

function Desk(): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const {
    screeningRules,
    rankingRules,
    configLoading,
    proposedRulesLoading,
    error: rulesError,
    retry: retryRules,
  } = useScreeningRules();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFirmId = searchParams.get("firmId") ?? undefined;
  const [selectedId, setSelectedIdState] = React.useState<string | undefined>(initialFirmId);
  const setSelectedId = React.useCallback(
    (id: string | undefined) => {
      setSelectedIdState(id);
      // Keep the URL in sync so the /pipeline → /desk handoff round-trips.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set("firmId", id);
          } else {
            next.delete("firmId");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // A link to another firm's Desk while the Desk is open (a lookalike, say) changes only the URL,
  // so the selection follows it. Only a change in the URL counts: a pick made here sets the state
  // first and the URL a moment later, and must not be undone in between.
  const urlFirmId = searchParams.get("firmId") ?? undefined;
  const lastUrlFirmId = React.useRef(urlFirmId);
  React.useEffect(() => {
    if (lastUrlFirmId.current === urlFirmId) {
      return;
    }
    lastUrlFirmId.current = urlFirmId;
    if (urlFirmId !== undefined) {
      setSelectedIdState(urlFirmId);
    }
  }, [urlFirmId]);

  // ── Search-scoped view ──────────────────────────────────────────────
  // ?search=<id> pins the queue to a specific Search's firm set. We
  // filter client-side against Search↔firms membership since the desk
  // still relies on useOsdkObjects(Firm) — the scoped getQueue query
  // isn't in the SDK yet, so we intentionally leave the master fetch
  // alone and narrow after the fact.
  const searchIdParam = searchParams.get("search") ?? "";
  const searchActive = searchIdParam !== "";

  const { data: pinnedSearchData, isLoading: pinnedSearchLoading } = useOsdkObjects(Search, {
    where: { searchId: { $eq: searchIdParam } },
    pageSize: 1,
  });
  const pinnedSearchList = pinnedSearchData ?? [];
  const pinnedSearch = searchActive ? pinnedSearchList[0] : undefined;
  // Raw WireObject for useLinks — the link traversal needs the
  // instance itself, not the widened POJO.
  const pinnedSearchInstance = searchActive ? (pinnedSearchData ?? [])[0] : undefined;
  const pinnedMandateId = pinnedSearch?.mandateId ?? "";

  // Sibling searches under the same mandate — we number the pinned one
  // by its rank (freshest = 1) when it doesn't have a human name.
  const { data: siblingSearchesData } = useOsdkObjects(Search, {
    where: { mandateId: { $eq: pinnedMandateId } },
    orderBy: { runAt: "desc" },
    autoFetchMore: true,
  });
  const searchIndex = React.useMemo<number | undefined>(() => {
    if (!searchActive) {
      return undefined;
    }
    const list = siblingSearchesData ?? [];
    const idx = list.findIndex((s) => s.searchId === searchIdParam);
    return idx >= 0 ? idx + 1 : undefined;
  }, [searchActive, siblingSearchesData, searchIdParam]);

  const { data: pinnedMandateData } = useOsdkObjects(Mandate, {
    where: { mandateId: { $eq: pinnedMandateId } },
    pageSize: 1,
  });
  const pinnedMandate = searchActive ? (pinnedMandateData ?? [])[0] : undefined;
  const pinnedIntent =
    (pinnedMandate?.intentStatement ?? "").trim() || (pinnedMandate?.title ?? "").trim() || "—";

  // Members via the Search↔firms M2M link. The API returns the full linked objects, and only
  // firmId and discoveredViaSearchId are read.
  const membership = useLinks(pinnedSearchInstance, "firms");
  // Null while a pinned search's membership is unresolved. An empty Set would read as "this
  // search has no firms" and filter every firm out before the links arrive.
  const membershipLoading =
    searchActive &&
    (pinnedSearchLoading || (pinnedSearchInstance !== undefined && membership.isLoading));
  const memberFirmIds = React.useMemo(() => {
    if (!searchActive || membershipLoading) {
      return null;
    }
    const arr = membership.linkedObjectsBySourcePrimaryKey.get(searchIdParam);
    const set = new Set<string>();
    for (const f of arr ?? []) {
      const id = f.firmId;
      if (typeof id === "string" && id !== "") {
        set.add(id);
      }
    }
    return set;
  }, [searchActive, membershipLoading, membership.linkedObjectsBySourcePrimaryKey, searchIdParam]);

  // Decisions load-bearing only when the filter is active (to compute
  // per-firm "N prior decisions"). Skipping the fetch when the desk is
  // unfiltered keeps the master view's request budget unchanged.
  const { data: decisionData } = useOsdkObjects(ReviewDecision, {
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });
  const priorDecisionCountByFirm = React.useMemo(() => {
    if (!searchActive) {
      return null;
    }
    // "Prior" = decided before this search was run. When runAt is
    // missing we fall back to counting every decision (best-effort — a
    // partially-populated search shouldn't render zero counts across
    // the board and mislead the analyst).
    const runAtRaw = pinnedSearch?.runAt;
    const runAtMs = ((): number => {
      // The wire sends an absent timestamp as null as well as leaving it out.
      if (runAtRaw === undefined || runAtRaw === null) {
        return Number.POSITIVE_INFINITY;
      }
      const t = new Date(runAtRaw).getTime();
      return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    })();
    const m = new Map<string, number>();
    for (const d of decisionData ?? []) {
      const fid = d.firmId ?? "";
      if (fid === "") {
        continue;
      }
      const raw = d.decidedAt;
      const t = raw === undefined || raw === null ? NaN : new Date(raw).getTime();
      if (Number.isNaN(t) || t >= runAtMs) {
        continue;
      }
      m.set(fid, (m.get(fid) ?? 0) + 1);
    }
    return m;
  }, [searchActive, decisionData, pinnedSearch?.runAt]);

  const filteredData = React.useMemo(() => {
    if (!searchActive) {
      return data ?? [];
    }
    if (memberFirmIds === null) {
      return [];
    }
    return (data ?? []).filter((f) => memberFirmIds.has(f.firmId ?? ""));
  }, [searchActive, memberFirmIds, data]);

  const rediscoveryByFirmId = React.useMemo<Map<string, RediscoveryInfo> | undefined>(() => {
    if (!searchActive || memberFirmIds === null) {
      return undefined;
    }
    const m = new Map<string, RediscoveryInfo>();
    for (const f of filteredData ?? []) {
      const fid = f.firmId ?? "";
      if (fid === "") {
        continue;
      }
      const discoveredVia = f.discoveredViaSearchId ?? null;
      const isNew = discoveredVia === searchIdParam;
      m.set(fid, {
        kind: isNew ? "new" : "rediscovered",
        priorDecisions: isNew ? 0 : (priorDecisionCountByFirm?.get(fid) ?? 0),
      });
    }
    return m;
  }, [searchActive, memberFirmIds, filteredData, searchIdParam, priorDecisionCountByFirm]);

  const onClearSearchFilter = React.useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("search");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const queue = React.useMemo(() => {
    // toQueueFirm carries what the ranker needs: lifecycle/currentStage (to push
    // terminal firms to the bottom — the desk is a to-do list, not a leaderboard),
    // disposition (server-side hard screens the client mirror can't reconstruct),
    // and the score and rule-axis properties (including the gate fields), so the
    // sidebar's live-queue partition screens on the same object it ranks. Home and
    // the server's homeSummary build the same input.
    const firms = (filteredData ?? []).map(toQueueFirm);
    return orderEnrichmentQueue(firms, rankingRules);
  }, [filteredData, rankingRules]);

  // With no firm in the URL, open on the first queue firm whose agent run is still open: the
  // firms `runAgentEnrichment` touched and no analyst has acted on yet (`enrichedBy` is the
  // agent until `enrichFirm` replaces it). Chosen on the screened queue order, so it waits for
  // the rules. `effectiveId` makes the pick visible in the same render; the URL follows.
  const openRunFirmIds = React.useMemo(
    () => agentRunFirmIds(filteredData ?? [], AGENT),
    [filteredData],
  );
  const defaultReady = !isLoading && !membershipLoading && !configLoading && !proposedRulesLoading;
  const defaultId =
    selectedId === undefined && defaultReady
      ? defaultDeskFirmId(
          queue.map((r) => r.firm.firmId),
          openRunFirmIds,
        )
      : undefined;
  const effectiveId = selectedId ?? defaultId;
  React.useEffect(() => {
    if (defaultId !== undefined) {
      setSelectedId(defaultId);
    }
  }, [defaultId, setSelectedId]);
  const resolvingDefault = selectedId === undefined && !defaultReady;

  const selected =
    effectiveId === undefined ? undefined : filteredData?.find((f) => f.firmId === effectiveId);
  const loadError = error ?? membership.error;

  // The open firm's tear sheet, from the command palette.
  const navigate = useNavigate();
  const selectedFirmId = selected?.firmId;
  const selectedName = selected?.firmName ?? selectedFirmId;
  const commands = React.useMemo<Command[]>(
    () =>
      selectedFirmId === undefined
        ? []
        : [
            {
              id: "desk:tear-sheet",
              label: `Tear sheet: ${selectedName}`,
              group: "Actions",
              run: () => navigate(`/firm/${encodeURIComponent(selectedFirmId)}/tear-sheet`),
            },
          ],
    [selectedFirmId, selectedName, navigate],
  );
  useCommands(commands);
  const panelState = deskPanelState({
    selectedId: effectiveId,
    firmsLoading: isLoading,
    membershipLoading,
    hasError: loadError !== undefined,
    searchActive,
    inView: selected !== undefined,
    inDatabase: effectiveId !== undefined && (data ?? []).some((f) => f.firmId === effectiveId),
    viewCount: filteredData?.length ?? 0,
  });

  // The queue's search text and "Show all firms" live here, above the sidebar portal, so they
  // survive the sidebar remounting its contents (drawer open/close, crossing the breakpoint).
  const filters = useQueueFilters();

  // Each row's state line: when the firm was last enriched and what is still waiting on it.
  const runByFirmId = React.useMemo(() => {
    const m = new Map<string, QueueRun>();
    for (const f of filteredData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, { enrichedAt: f.enrichedAt ?? null, enrichedBy: f.enrichedBy ?? null });
      }
    }
    return m;
  }, [filteredData]);
  const { data: allFindings } = useOsdkObjects(ResearchFinding, { autoFetchMore: true });
  const countsByFirmId = React.useMemo<Map<string, FindingCounts>>(
    () => findingCountsByFirm(allFindings ?? []),
    [allFindings],
  );

  // The firm queue lives in the app shell's sidebar, under the nav.
  const queueSidebar = useSidebarSlot(
    <QueueSidebar
      queue={queue}
      isLoading={isLoading}
      selectedId={effectiveId}
      onSelect={setSelectedId}
      screeningRules={screeningRules}
      scopeLabel={searchActive ? "in search" : "in database"}
      membershipPinned={searchActive}
      rediscoveryByFirmId={rediscoveryByFirmId}
      query={filters.query}
      onQueryChange={filters.setQuery}
      showAll={filters.showAll}
      onShowAllChange={filters.setShowAll}
      runByFirmId={runByFirmId}
      countsByFirmId={countsByFirmId}
    />,
  );

  return (
    <div className={styles.desk}>
      {queueSidebar}
      {searchActive && (
        <SearchFilterBar
          intentText={pinnedIntent}
          searchName={pinnedSearch?.name ?? null}
          searchRunAt={pinnedSearch?.runAt ?? null}
          searchIndex={searchIndex}
          memberCount={filteredData?.length ?? 0}
          loading={memberFirmIds === null}
          exportAction={
            <ExportMenu
              name={`${pinnedIntent} ${searchLabel(pinnedSearch?.name, pinnedSearch?.runAt) || `search ${searchIndex ?? ""}`}`}
              firms={filteredData ?? []}
              findings={allFindings}
            />
          }
          onClear={onClearSearchFilter}
        />
      )}
      {loadError && panelState !== "error" && (
        <div role="alert" className={styles.error}>
          {errorMessage(loadError)}
        </div>
      )}
      {rulesError !== undefined && (
        <RetryNotice
          className={styles.rulesError}
          message={`Couldn’t load the screening rules (${errorMessage(rulesError).replace(/[.\s]+$/, "")}). Firms are ranked without them until they load.`}
          onRetry={retryRules}
        />
      )}
      <div className={styles.body}>
        {panelState === "firm" && selected !== undefined && (
          <EnrichmentPanel
            firm={selected}
            allFirms={filteredData ?? []}
            firmsLoading={isLoading}
            // Same rule list the queue ranks and partitions on, so the firm
            // header's hard-screen chip can't call a firm workable while the
            // sidebar shows it screened.
            activeConfigs={rankingRules}
            configsLoading={configLoading}
          />
        )}
        {panelState === "skeleton" && <FirmSkeleton />}
        {panelState === "not-found" && effectiveId !== undefined && (
          <FirmNotFound firmId={effectiveId} />
        )}
        {panelState === "not-in-search" && <FirmNotInSearch onClear={onClearSearchFilter} />}
        {panelState === "search-empty" && <SearchEmpty loading={memberFirmIds === null} />}
        {panelState === "error" && <LoadFailed message={errorMessage(loadError)} />}
        {panelState === "queue-empty" && <EmptyQueue />}
        {panelState === "empty" && (resolvingDefault ? <FirmSkeleton /> : <PickAFirm />)}
      </div>
    </div>
  );
}

export default Desk;
