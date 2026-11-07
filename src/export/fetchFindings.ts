import type { QueryClient } from "@tanstack/react-query";
import type { DataAdapter } from "@/data/adapter";
import { getPersona } from "@/data/persona";
import type { FindingLike } from "../../shared/exportRows";

const PAGE = 1000;
/** How long a fetched set counts as current. An action that writes findings invalidates it sooner. */
const FRESH_MS = 60_000;

/**
 * Every ResearchFinding, page by page, through the query cache: a second export (or one right after
 * a page already fetched them) makes no request. The key starts with ["objects", "ResearchFinding"],
 * so any action that writes findings refreshes it. Used when an export is asked for, not on page load.
 */
export function fetchAllFindings(
  qc: QueryClient,
  adapter: Pick<DataAdapter, "listObjects">,
): Promise<FindingLike[]> {
  const persona = getPersona();
  return qc.fetchQuery({
    queryKey: ["objects", "ResearchFinding", "all", persona],
    staleTime: FRESH_MS,
    queryFn: async () => {
      const out: FindingLike[] = [];
      let pageToken: string | undefined;
      do {
        const page = await adapter.listObjects("ResearchFinding", { pageSize: PAGE, pageToken });
        out.push(...page.data);
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken !== undefined);
      return out;
    },
  });
}
