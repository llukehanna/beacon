import React from "react";
import { type PipelineSort, type PipelineSortKey } from "@/desk/pipelineRows";
import { Skeleton } from "@/ui";
import { FirmCards } from "./FirmCards";
import { FirmTable } from "./FirmTable";
import type { Row } from "./pipelineModel";

/** The firms as a table, or as cards on narrow screens; a skeleton while loading, `empty` when none. */
export function FirmList({
  rows,
  loading,
  empty,
  cards,
  selectedId,
  onSelect,
  scrollRef,
  sort,
  onSort,
  now,
}: {
  rows: readonly Row[];
  loading: boolean;
  /** Shown when there are no rows and nothing is loading. */
  empty: React.ReactNode;
  cards: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  scrollRef: React.RefObject<HTMLElement>;
  sort: PipelineSort;
  onSort: (key: PipelineSortKey) => void;
  now: number;
}): React.ReactElement {
  if (loading && rows.length === 0) {
    return (
      <div aria-busy="true" aria-label="Loading firms">
        <Skeleton height={36 * 8} />
      </div>
    );
  }
  if (rows.length === 0) {
    return <>{empty}</>;
  }
  return cards ? (
    <FirmCards
      rows={rows}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollRef={scrollRef}
      now={now}
    />
  ) : (
    <FirmTable
      rows={rows}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollRef={scrollRef}
      sort={sort}
      onSort={onSort}
      now={now}
    />
  );
}
