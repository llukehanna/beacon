import React from "react";
import { useSearchParams } from "react-router-dom";
import { SourceDrawerProvider } from "@/components/SourceDrawer";
import { useLinks, useOsdkObjects } from "@/data/hooks";
import {
  Firm,
  HardScreenConfig,
  Mandate,
  ProposedRule,
  ReviewDecision,
  Search,
} from "@/data/ontology";
import { useSidebarSlot } from "@/shell/sidebarSlot";
import { AGENT } from "../../../shared/vocab";
import { type ScreeningRule, toScreeningRules } from "../activeScreening";
import { agentRunFirmIds, defaultDeskFirmId } from "../deskDefaults";
import { deskPanelState } from "../deskPanelState";
import "../nocturne.css";
import { type ActiveConfigRule, orderEnrichmentQueue, toQueueFirm } from "../queue";
import { EnrichmentPanel } from "./EnrichmentPanel";
import { QueueSidebar, SearchFilterBar } from "./QueueSidebar";
import { type FirmView, type RediscoveryInfo } from "./deskModel";

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 380, textAlign: "center", padding: 32 }}>
        <span
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 44,
            height: 44,
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-accent)",
            color: "var(--color-accent)",
            fontSize: 19,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          B
        </span>
        <div style={{ fontSize: 19, fontWeight: 500, marginBottom: 8 }}>Pick a firm</div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            lineHeight: 1.55,
          }}
        >
          Choose a firm from the queue on the left. Firms are ordered by how much a decision would
          change their score. Firms screened out by approved rules are hidden unless you turn on
          Show all firms.
        </p>
      </div>
    </div>
  );
}

/** Placeholder while a deep-linked firm is still loading; shaped like the firm header and axis list. */
function FirmSkeleton(): React.ReactElement {
  const bar = (width: number | string, height: number): React.CSSProperties => ({
    width,
    height,
    borderRadius: "var(--radius-sm)",
    background:
      "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 18%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
    backgroundSize: "200% 100%",
    animation: "beacon-shimmer 1.6s linear infinite",
  });
  return (
    <div
      role="status"
      aria-label="Loading firm"
      style={{ flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={bar(280, 26)} />
          <div style={bar(200, 13)} />
        </div>
        <div style={bar(96, 44)} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={bar("100%", 36)} />
        ))}
      </div>
    </div>
  );
}

/** A deep-linked firm that exists but is outside the pinned search's membership. */
function FirmNotInSearch({ onClear }: { onClear: () => void }): React.ReactElement {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 380, textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 19, fontWeight: 500, marginBottom: 8 }}>
          {"This firm isn't in the current search"}
        </div>
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            lineHeight: 1.55,
          }}
        >
          The queue is limited to the firms this search found. Clear the search filter to see every
          firm.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onClear}>
          Clear search filter
        </button>
      </div>
    </div>
  );
}

/** A deep-linked firm id that is not in the database. */
function FirmNotFound({ firmId }: { firmId: string }): React.ReactElement {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 380, textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 19, fontWeight: 500, marginBottom: 8 }}>Firm not found</div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
            lineHeight: 1.55,
            overflowWrap: "anywhere",
          }}
        >
          No firm with id {firmId} is in the database. Choose one from the queue on the left.
        </p>
      </div>
    </div>
  );
}

function Desk(): React.ReactElement {
  const { data, isLoading, error } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  // Active approved HardScreenConfig rows drive the shared hard-screen
  // verdict for both the queue and the header/badge — see queue.ts
  // computeHardScreen. Filter to configActive === true so pending or
  // dismissed proposals cannot silently screen firms.
  const { data: configData, isLoading: configLoading } = useOsdkObjects(HardScreenConfig, {
    autoFetchMore: true,
  });
  const activeConfigs = React.useMemo<ActiveConfigRule[]>(() => {
    return (
      (
        (configData ?? []) as unknown as Array<{
          configRuleId: string;
          configActive?: boolean;
          configAxis?: string;
          configOperator?: string;
          configThreshold?: string;
          configModel?: string;
        }>
      )
        .filter((r) => r.configActive === true)
        .map((r) => ({
          ruleId: r.configRuleId,
          axis: r.configAxis ?? "",
          operator: r.configOperator ?? "",
          threshold: r.configThreshold ?? "",
          model: r.configModel ?? "both",
        }))
        // Skip malformed rows — a rule with no axis / no operator / no
        // threshold can't be evaluated. Better to omit than to false-positive.
        .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "")
    );
  }, [configData]);

  // The approved rules /rules renders. The desk screens on these directly
  // rather than waiting for HardScreenConfig rows to exist — that dependency
  // is what let the header read "711 of 711" while /rules showed an approved
  // rule claiming 160 firms. Config rows still win where present, because an
  // amended threshold is what the analyst sees as the effective predicate.
  const { data: proposedRuleData, isLoading: proposedRulesLoading } = useOsdkObjects(ProposedRule, {
    autoFetchMore: true,
  });
  const screeningRules = React.useMemo<ScreeningRule[]>(
    () =>
      toScreeningRules(
        (proposedRuleData ?? []) as unknown as Parameters<typeof toScreeningRules>[0],
        (configData ?? []) as unknown as Parameters<typeof toScreeningRules>[1],
      ),
    [proposedRuleData, configData],
  );

  // One rule list drives ranking and the view filter. ScreeningRule is a
  // superset of ActiveConfigRule, so the queue's shared hard-screen verdict
  // reads the same approved rules the sidebar partitions on.
  const rankingRules = React.useMemo<ActiveConfigRule[]>(() => {
    const seen = new Set(screeningRules.map((r) => r.ruleId));
    return [...screeningRules, ...activeConfigs.filter((c) => !seen.has(c.ruleId))];
  }, [screeningRules, activeConfigs]);
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
  const pinnedSearchList = (pinnedSearchData ?? []) as unknown as Array<{
    searchId: string;
    mandateId?: string | null;
    name?: string | null;
    runAt?: string | number | Date | null;
  }>;
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
    const list = (siblingSearchesData ?? []) as unknown as Array<{ searchId: string }>;
    const idx = list.findIndex((s) => s.searchId === searchIdParam);
    return idx >= 0 ? idx + 1 : undefined;
  }, [searchActive, siblingSearchesData, searchIdParam]);

  const { data: pinnedMandateData } = useOsdkObjects(Mandate, {
    where: { mandateId: { $eq: pinnedMandateId } },
    pageSize: 1,
  });
  const pinnedMandate = searchActive
    ? (
        (pinnedMandateData ?? []) as unknown as Array<{
          intentStatement?: string | null;
          title?: string | null;
        }>
      )[0]
    : undefined;
  const pinnedIntent =
    (pinnedMandate?.intentStatement ?? "").trim() || (pinnedMandate?.title ?? "").trim() || "—";

  // Members via the Search↔firms M2M link. The API returns full linked
  // objects — we only need firmId + discoveredViaSearchId, but there's
  // no way to $select on useLinks without breaking the pinnedSearch
  // instance shape, so we take the whole payload.
  const membership = useLinks(pinnedSearchInstance as never, "firms", {
    pageSize: 500,
  });
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
      const id = (f as unknown as { firmId?: string }).firmId;
      if (id !== undefined && id !== "") {
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
    const runAtRaw = pinnedSearch?.runAt ?? null;
    const runAtMs = ((): number => {
      if (runAtRaw === null || runAtRaw === undefined) {
        return Number.POSITIVE_INFINITY;
      }
      const t =
        runAtRaw instanceof Date
          ? runAtRaw.getTime()
          : new Date(runAtRaw as string | number).getTime();
      return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    })();
    const m = new Map<string, number>();
    for (const d of (decisionData ?? []) as unknown as Array<{
      firmId?: string;
      decidedAt?: unknown;
    }>) {
      const fid = d.firmId ?? "";
      if (fid === "") {
        continue;
      }
      const raw = d.decidedAt;
      const t =
        raw instanceof Date
          ? raw.getTime()
          : raw !== undefined && raw !== null
            ? new Date(raw as string | number).getTime()
            : NaN;
      if (Number.isNaN(t) || t >= runAtMs) {
        continue;
      }
      m.set(fid, (m.get(fid) ?? 0) + 1);
    }
    return m;
  }, [searchActive, decisionData, pinnedSearch?.runAt]);

  const filteredData = React.useMemo(() => {
    if (!searchActive) {
      return (data ?? []) as typeof data;
    }
    if (memberFirmIds === null) {
      return [] as unknown as typeof data;
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
      const discoveredVia =
        (f as unknown as { discoveredViaSearchId?: string | null }).discoveredViaSearchId ?? null;
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
    />,
  );

  return (
    <SourceDrawerProvider>
      <div
        className="dsn"
        style={{
          height: "100%",
          background: "transparent",
          display: "flex",
        }}
      >
        {queueSidebar}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {searchActive && (
            <SearchFilterBar
              intentText={pinnedIntent}
              searchName={pinnedSearch?.name ?? null}
              searchIndex={searchIndex}
              memberCount={filteredData?.length ?? 0}
              loading={memberFirmIds === null}
              onClear={onClearSearchFilter}
            />
          )}
          {loadError && (
            <div
              role="alert"
              style={{
                padding: "8px 24px",
                background: "rgba(240,113,103,.12)",
                color: "#f4948b",
                fontSize: 12,
              }}
            >
              {String(loadError)}
            </div>
          )}
          {panelState === "firm" && selected !== undefined && (
            <EnrichmentPanel
              firm={selected}
              actionFirm={selected}
              allFirms={(filteredData ?? []) as unknown as FirmView[]}
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
          {panelState === "search-empty" && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 32,
                textAlign: "center",
                color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {memberFirmIds === null
                ? "Loading search membership…"
                : "This search returned no firms yet. If it just launched, give the backend a moment to attach dedupes and create discoveries. The queue populates as membership lands."}
            </div>
          )}
          {panelState === "empty" && (resolvingDefault ? <FirmSkeleton /> : <EmptyState />)}
          {panelState === "error" && <div style={{ flex: 1 }} />}
        </div>
      </div>
    </SourceDrawerProvider>
  );
}

export default Desk;
