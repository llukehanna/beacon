import React from "react";
import { Link } from "react-router-dom";
import { useLinks } from "@/data/hooks";
import { ExportMenu } from "@/export/ExportMenu";
import { ButtonLink, Chip, Panel } from "@/ui";
import type { FirmLike } from "../../shared/exportRows";
import { type MandateFirmCounts } from "../../shared/mandateFirms";
import styles from "./MandateCard.module.css";
import {
  FIRM_COUNT_PAGE_SIZE,
  type MandateLike,
  type SearchListLike,
  mandateHeadline,
} from "./mandateModel";

/**
 * One search list with its firm count. Membership comes from the searchLists↔firms link: the
 * SearchList.resultCount property is a stale snapshot from creation time, so only the ids of the
 * linked firms are fetched.
 */
export function SearchListRow({
  searchInstance,
  searchId,
  displayName,
}: {
  // The WireObject from useOsdkObjects(SearchList): useLinks needs it (not a plain copy) to
  // traverse the link and key the result by primary key.
  searchInstance: unknown;
  searchId: string;
  displayName: string;
}): React.ReactElement {
  const { linkedObjectsBySourcePrimaryKey, hasMore, isLoading, error } = useLinks(
    searchInstance as never,
    "firms",
    { pageSize: FIRM_COUNT_PAGE_SIZE, $select: ["firmId"] as never },
  );
  const firms = linkedObjectsBySourcePrimaryKey.get(searchId);
  const count = firms?.length ?? 0;
  const countLabel =
    error !== undefined
      ? "?"
      : isLoading && firms === undefined
        ? "…"
        : hasMore
          ? `${count}+`
          : `${count}`;

  return (
    <li className={styles.list}>
      <span className={styles.listName}>{displayName}</span>
      {/* Per-list count, distinct from the mandate-level line above: naming the level stops the
          two being read as a contradiction. */}
      <span
        className={styles.listCount}
        title="Firms linked to this search list. The mandate's scoped total also counts firms its searches attached or created."
      >
        <span className={styles.figure}>{countLabel}</span> in this list
      </span>
      <Link to="/desk" className={styles.link}>
        Work in desk →
      </Link>
    </li>
  );
}

/** A mandate with how many firms it has scoped, where to interpret it into a search, and its lists. */
export function MandateCard({
  mandate,
  searches,
  counts,
  firms,
  countsLoading,
}: {
  mandate: MandateLike;
  searches: SearchListLike[];
  /** The mandate-level union, identical to Home's; the rows below count one list each. */
  counts: MandateFirmCounts;
  /** The scoped firms those counts are of: what Export writes. */
  firms: readonly FirmLike[];
  countsLoading: boolean;
}): React.ReactElement {
  const headline = mandateHeadline(mandate);
  const searchPath = `/search/${encodeURIComponent(mandate.mandateId)}`;
  return (
    <Panel className={styles.card} aria-label={headline} data-tour="mandate">
      <div className={styles.head}>
        <h2 className={styles.title}>
          <Link to={searchPath} className={styles.titleLink}>
            {headline}
          </Link>
        </h2>
        <div className={styles.tags}>
          {mandate.archetype && <Chip>{mandate.archetype}</Chip>}
          {mandate.priority && <Chip>{mandate.priority}</Chip>}
        </div>
      </div>

      {/* Same union, same wording as Home's mandate row. */}
      <div
        className={styles.counts}
        title="Scoped = every firm in this mandate's lists and searches. From searches = the subset a Search run attached."
      >
        {countsLoading ? (
          "…"
        ) : (
          <>
            <span className={styles.figure}>{counts.scoped}</span> scoped ·{" "}
            <span className={styles.figure}>{counts.fromSearches}</span> from searches
          </>
        )}
      </div>

      <div className={styles.actions}>
        <ButtonLink
          to={searchPath}
          variant="primary"
          title="Turn this intent sentence into a Search: pick geographies / seeds / breadth on the next screen"
        >
          Interpret &amp; run search <span aria-hidden="true">→</span>
        </ButtonLink>
        <ExportMenu name={headline} firms={firms} />
      </div>

      {searches.length === 0 ? (
        <p className={styles.empty}>No searches yet for this mandate.</p>
      ) : (
        <ul className={styles.lists}>
          {searches.map((s) => (
            <SearchListRow
              key={s.searchId}
              searchInstance={s}
              searchId={s.searchId}
              displayName={s.name ?? s.searchId}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
