import { fetchObjectsPage } from "@/data/api";
import type { FindingLike } from "../../shared/exportRows";

const PAGE = 1000;

/** Every ResearchFinding, page by page. Used when an export is asked for, not on page load. */
export async function fetchAllFindings(): Promise<FindingLike[]> {
  const out: FindingLike[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchObjectsPage("ResearchFinding", { pageSize: PAGE, pageToken });
    out.push(...page.data);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken !== undefined);
  return out;
}
