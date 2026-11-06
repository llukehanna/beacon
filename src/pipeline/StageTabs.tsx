import React from "react";
import { Skeleton } from "@/ui";
import styles from "./StageTabs.module.css";
import { STAGE_FILTERS, type StageFilter } from "./pipelineModel";

const LABEL = (stage: StageFilter): string => (stage === "all" ? "All" : stage);

/**
 * The stage filter: every firm, each of the eight funnel stages, and Passed, each with its count.
 * A radio group, so the arrow keys move the choice and Tab passes over the rest.
 */
export function StageTabs({
  value,
  counts,
  loading,
  onChange,
}: {
  value: StageFilter;
  counts: Record<StageFilter, number>;
  /** True while the firms load: every count would read 0, so a placeholder stands in. */
  loading: boolean;
  onChange: (stage: StageFilter) => void;
}): React.ReactElement {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number): void => {
    const last = STAGE_FILTERS.length - 1;
    const target =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (index + 1) % STAGE_FILTERS.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (index + last) % STAGE_FILTERS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (target === null) {
      return;
    }
    e.preventDefault();
    onChange(STAGE_FILTERS[target]);
    refs.current[target]?.focus();
  };

  return (
    <div className={styles.tabs} role="radiogroup" aria-label="Stage">
      {STAGE_FILTERS.map((stage, i) => {
        const checked = stage === value;
        return (
          <button
            key={stage}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.tab}
            data-stage={stage}
            onClick={() => onChange(stage)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className={styles.name}>{LABEL(stage)}</span>
            <span className={styles.count}>
              {loading ? (
                <span className={styles.wait}>
                  <Skeleton height={10} />
                </span>
              ) : (
                counts[stage].toLocaleString("en-US")
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
