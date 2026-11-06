import React from "react";
import { type PipelineSort, type PipelineSortKey } from "@/desk/pipelineRows";
import { Button } from "@/ui";
import { OWNERSHIP_TYPES, REVENUE_BANDS, SUCCESSION_RISKS } from "../../shared/vocab";
import styles from "./Filters.module.css";
import { type ProfileFilter, SORT_LABEL } from "./pipelineModel";

const PROFILE_FILTERS: ReadonlyArray<{
  key: keyof ProfileFilter;
  label: string;
  options: readonly string[];
}> = [
  { key: "revenueBand", label: "Revenue", options: REVENUE_BANDS },
  { key: "ownership", label: "Ownership", options: OWNERSHIP_TYPES },
  { key: "successionRisk", label: "Succession risk", options: SUCCESSION_RISKS },
];

const SORT_KEYS: readonly PipelineSortKey[] = ["stage", "score", "name"];

/**
 * Profile filters (revenue, ownership, succession risk) and, on screens where the table's column
 * headers are gone, the sort choice.
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
  return (
    <div className={styles.filters}>
      {PROFILE_FILTERS.map(({ key, label, options }) => (
        <select
          key={key}
          className={styles.select}
          value={profile[key]}
          onChange={(e) => onProfile({ ...profile, [key]: e.target.value })}
          aria-label={label}
        >
          <option value="">{label}: any</option>
          {options.map((o) => (
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
