import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Panel, Skeleton } from "@/ui";
import type { Lifecycle } from "../../shared/pipelineBuckets";
import { LIFECYCLE_STAGES, PASSED } from "../../shared/vocab";
import styles from "./PipelineFunnel.module.css";
import { SectionHead } from "./SectionHead";
import { funnelBars } from "./funnel";

const MAX_PX = 80;
const STAGES = [...LIFECYCLE_STAGES, PASSED] as const;

/** Stage a bar leads to on the Pipeline page. */
const stageHref = (stage: string) => `/pipeline?stage=${encodeURIComponent(stage)}`;

/**
 * One bar per lifecycle stage, tallest for the stage holding the most firms, and Passed as a
 * hatched bar at the end. Every bar opens the Pipeline filtered to that stage.
 */
export function PipelineFunnel({ counts }: { counts: Record<Lifecycle, number> | undefined }) {
  const total = counts === undefined ? undefined : STAGES.reduce((n, s) => n + counts[s], 0);
  const bars = counts === undefined ? [] : funnelBars(counts, STAGES, 6, MAX_PX);
  return (
    <Panel className={styles.funnel} aria-label="Pipeline">
      <SectionHead
        title="Pipeline"
        count={total?.toLocaleString("en-US")}
        to="/pipeline"
        linkLabel="Open pipeline"
      />
      {counts === undefined ? (
        <div className={styles.loading}>
          <Skeleton height={MAX_PX + 50} />
        </div>
      ) : (
        <ol className={styles.stages}>
          {bars.map(({ stage, count, px }) => (
            <li key={stage} className={stage === PASSED ? styles.passed : undefined}>
              <Link
                to={stageHref(stage)}
                className={styles.stage}
                data-stage={stage}
                aria-label={`${stage}: ${count} firms`}
              >
                <span className={styles.plot}>
                  <span className={styles.count} data-empty={count === 0 || undefined}>
                    {count.toLocaleString("en-US")}
                  </span>
                  <span
                    className={styles.bar}
                    data-empty={count === 0 || undefined}
                    style={
                      {
                        "--px": `${px}px`,
                        "--share": `${(px / MAX_PX) * 100}%`,
                      } as CSSProperties
                    }
                  />
                </span>
                <span className={styles.label}>{stage}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
