import React from "react";
import { useRubric } from "@/data/rubricContext";
import { type PipelineSort, type PipelineSortKey } from "@/desk/pipelineRows";
import { Button } from "@/ui";
import styles from "./Filters.module.css";
import { type ProfileFilter, SORT_LABEL } from "./pipelineModel";

const SORT_KEYS: readonly PipelineSortKey[] = ["stage", "score", "name"];

/**
 * A filter per profile trait in the catalog (revenue band, ownership and succession risk for the
 * advisory workspace) and, on screens where the table's column headers are gone, the sort choice.
 */
export function Filters({
  profile,
  onProfile,
  sort,
  onSort,
}: {
  profile: ProfileFilter;
  onProfile: (next: ProfileFilter) => void;
  sort: PipelineSort;
  onSort: (next: PipelineSort) => void;
}): React.ReactElement {
  const profileFilters = useRubric().traits.filter(
    (t) => t.role === "profile" && t.kind === "category",
  );
  return (
    <div className={styles.filters}>
      {profileFilters.map(({ traitKey: key, label, options }) => (
        <select
          key={key}
          className={styles.select}
          value={profile[key] ?? ""}
          onChange={(e) => onProfile({ ...profile, [key]: e.target.value })}
          aria-label={label}
        >
          <option value="">{label}: any</option>
          {(options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ))}
      {/* The table sorts from its column headers; cards have none, so the choice moves here. */}
      <span className={styles.sort}>
        <select
          className={styles.select}
          value={sort.key}
          onChange={(e) => onSort({ key: e.target.value as PipelineSortKey, reversed: false })}
          aria-label="Sort by"
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              Sort: {SORT_LABEL[k]}
            </option>
          ))}
        </select>
        <Button
          aria-pressed={sort.reversed}
          onClick={() => onSort({ ...sort, reversed: !sort.reversed })}
        >
          Reverse order
        </Button>
      </span>
    </div>
  );
}
