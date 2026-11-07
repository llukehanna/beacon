import React from "react";
import { errorMessage } from "@/data/adapter";
import { useLinks, useOsdkObjects } from "@/data/hooks";
import { Firm, Mandate, Search, SearchList, SearchMembership } from "@/data/ontology";
import { type Command, useCommands } from "@/shell/commands";
import { EmptyState, Notice, PageHeader, Panel, Skeleton } from "@/ui";
import type { FirmLike as ExportFirm } from "../../shared/exportRows";
import {
  EMPTY_COUNTS,
  countMandateFirms,
  mandateFirmIds,
  searchListFirmIds,
} from "../../shared/mandateFirms";
import { MandateCard, SearchListRow } from "./MandateCard";
import styles from "./MandatePage.module.css";
import { NewMandateForm } from "./NewMandateForm";
import { type SearchListLike } from "./mandateModel";

const NO_FIRMS: readonly ExportFirm[] = [];

/**
 * Mandates: leadership sets a mandate as a free-text intent, and each mandate spawns one or more
 * Searches that assemble the candidate universe. Each card links to the page that interprets the
 * mandate into a Search.
 */
export default function MandatePage(): React.ReactElement {
  const {
    data: mandateData,
    isLoading: mandatesLoading,
    error: mandatesError,
  } = useOsdkObjects(Mandate, {
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
  });
  const { data: searchData, error: searchError } = useOsdkObjects(SearchList, {
    orderBy: { createdAt: "desc" },
    autoFetchMore: true,
  });

  // The other two legs of the scoped union (see shared/mandateFirms). Counting only the
  // SearchList↔firms link once made this page read "285 firms" against Home's "317 scoped".
  const { data: searchObjData } = useOsdkObjects(Search, { autoFetchMore: true });
  const { data: membershipData } = useOsdkObjects(SearchMembership, {
    pageSize: 1000,
    autoFetchMore: true,
  });
  const { data: firmData } = useOsdkObjects(Firm, { autoFetchMore: true });

  const mandates = React.useMemo(() => mandateData ?? [], [mandateData]);
  const searchLists = React.useMemo(() => searchData ?? [], [searchData]);

  // One batched traversal of SearchList↔firms for the mandate-level union, alongside the per-row
  // useLinks that renders each list's own count.
  const searchListInstances = React.useMemo(() => searchData ?? [], [searchData]);
  const searchListLinks = useLinks(searchListInstances, "firms");

  const idsByMandate = React.useMemo(
    () =>
      mandateFirmIds({
        searches: searchObjData ?? [],
        memberships: membershipData ?? [],
        firms: firmData ?? [],
        searchLists,
        searchListFirmIds: searchListFirmIds(searchListLinks.linkedObjectsBySourcePrimaryKey),
      }),
    [
      searchObjData,
      membershipData,
      firmData,
      searchLists,
      searchListLinks.linkedObjectsBySourcePrimaryKey,
    ],
  );

  const countsByMandate = React.useMemo(() => countMandateFirms(idsByMandate), [idsByMandate]);

  // The scoped firms behind each card's count, as the export writes them.
  const firmsByMandate = React.useMemo(() => {
    const byId = new Map<string, ExportFirm>();
    for (const f of firmData ?? []) {
      byId.set(f.firmId ?? "", f);
    }
    const out = new Map<string, ExportFirm[]>();
    for (const [mid, ids] of idsByMandate) {
      out.set(
        mid,
        [...ids.scoped].flatMap((id) => byId.get(id) ?? []),
      );
    }
    return out;
  }, [idsByMandate, firmData]);

  const searchesByMandate = React.useMemo(() => {
    const m = new Map<string, SearchListLike[]>();
    for (const s of searchLists) {
      const mid = s.mandateId ?? "";
      if (mid === "") {
        continue;
      }
      m.set(mid, [...(m.get(mid) ?? []), s]);
    }
    return m;
  }, [searchLists]);

  const orphans = React.useMemo(
    () =>
      searchLists.filter((s) => {
        const mid = s.mandateId ?? "";
        return mid === "" || !mandates.some((m) => m.mandateId === mid);
      }),
    [searchLists, mandates],
  );

  const intentRef = React.useRef<HTMLTextAreaElement>(null);
  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: "mandate:new",
        label: "New mandate",
        group: "Actions",
        run: () => intentRef.current?.focus(),
      },
    ],
    [],
  );
  useCommands(commands);

  const anyError = mandatesError ?? searchError;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Mandates"
        sub="Leadership sets a mandate as a free-text intent; each mandate spawns one or more searches that assemble the candidate universe. A firm can be in the scope of several mandates, so the counts overlap."
      />
      {anyError !== undefined && anyError !== null && (
        <Notice className={styles.error}>{errorMessage(anyError)}</Notice>
      )}

      <div className={styles.scroll}>
        <div className={styles.layout}>
          <NewMandateForm intentRef={intentRef} />

          <div className={styles.list}>
            {mandatesLoading && mandates.length === 0 && (
              <Panel className={styles.loading}>
                <Skeleton lines={3} />
              </Panel>
            )}
            {!mandatesLoading && mandates.length === 0 && (
              <EmptyState
                title="No mandates yet"
                body="Use the form to scope one: write the intent, pick an archetype and a priority."
              />
            )}
            {mandates.map((m) => (
              <MandateCard
                key={m.mandateId}
                mandate={m}
                searches={searchesByMandate.get(m.mandateId) ?? []}
                counts={countsByMandate.get(m.mandateId) ?? EMPTY_COUNTS}
                firms={firmsByMandate.get(m.mandateId) ?? NO_FIRMS}
                countsLoading={searchListLinks.isLoading && countsByMandate.size === 0}
              />
            ))}

            {orphans.length > 0 && (
              <Panel className={styles.orphans} aria-label="Unattached searches">
                <h2 className={styles.heading}>Unattached searches</h2>
                <ul className={styles.orphanList}>
                  {orphans.map((s) => (
                    <SearchListRow
                      key={s.searchId}
                      searchId={s.searchId}
                      displayName={s.name ?? s.searchId}
                    />
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
