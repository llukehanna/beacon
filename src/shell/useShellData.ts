import { useSearchParams } from "react-router-dom";
import { useOsdkObjects, useOsdkQuery } from "@/data/hooks";
import { Firm, Mandate, Search } from "@/data/ontology";
import type { HomeSummary } from "../../shared/summaries";

export interface ShellCounts {
  /** Firms the funnel counts as open (Discovered or Screening); undefined while loading. */
  open: number | undefined;
  /** Drift events waiting on a decision; undefined while loading. */
  review: number | undefined;
  /** Active mandates; undefined while loading. */
  activeMandates: number | undefined;
}

/** Counts for the sidebar and status bar, from the summary query Home already uses. */
export function useShellCounts(): ShellCounts {
  const { data } = useOsdkQuery<HomeSummary>("homeSummary");
  if (data === undefined) {
    return { open: undefined, review: undefined, activeMandates: undefined };
  }
  return {
    open: data.funnel.Discovered + data.funnel.Screening,
    review: data.needsYouCounts.review,
    activeMandates: data.mandates.length,
  };
}

interface DeskScope {
  /** Title of the mandate the Desk is scoped to by ?search=; null when none is selected. */
  mandate: string | null;
  /** Name of the firm open on the Desk; null when none is selected. */
  firm: string | null;
}

/** What the Desk is currently pointed at, read from its URL. Cached queries, shared with the Desk. */
export function useDeskScope(enabled: boolean): DeskScope {
  const [params] = useSearchParams();
  const searchId = enabled ? (params.get("search") ?? "") : "";
  const firmId = enabled ? (params.get("firmId") ?? "") : "";

  const { data: searches } = useOsdkObjects(Search, {
    where: { searchId: { $eq: searchId } },
    pageSize: 1,
    enabled: searchId !== "",
  });
  const mandateId =
    searchId === ""
      ? ""
      : (((searches ?? []) as unknown as Array<{ mandateId?: string | null }>)[0]?.mandateId ?? "");
  const { data: mandates } = useOsdkObjects(Mandate, {
    where: { mandateId: { $eq: mandateId } },
    pageSize: 1,
    enabled: mandateId !== "",
  });
  const { data: firms } = useOsdkObjects(Firm, {
    where: { firmId: { $eq: firmId } },
    pageSize: 1,
    enabled: firmId !== "",
  });

  const mandate = mandateId === "" ? undefined : (mandates ?? [])[0];
  const mandateTitle = (mandate as unknown as { title?: string | null } | undefined)?.title ?? null;
  const firm = firmId === "" ? undefined : (firms ?? [])[0];
  return {
    mandate: mandateId === "" ? null : (mandateTitle ?? mandateId),
    firm: (firm as unknown as { firmName?: string | null } | undefined)?.firmName ?? null,
  };
}
