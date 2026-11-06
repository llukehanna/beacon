import React from "react";
import { outcomeLabel } from "@/desk/tokens";
import { SectionHead } from "@/home/SectionHead";
import { Panel } from "@/ui";
import { SYNTHETIC_LABEL } from "../../shared/marketSignals";
import { NULL_OUTCOME_KEY, OUTCOME_SLOTS, type OutcomeTally } from "../../shared/trustMetrics";
import { ACQUIRED_BY_COMPETITOR } from "../../shared/vocab";
import styles from "./OutcomesPanel.module.css";

/**
 * What actually happened to the firms: a count for each observed outcome, one quiet line for the
 * bulk with no outcome yet, and the headline the drift loop exists for ("of firms we passed, N were
 * later acquired"). Counts only, no chart: five numbers do not need one.
 */
export function OutcomesPanel({ tally }: { tally: OutcomeTally }): React.ReactElement {
  const { counts, passed, passedAndAcquired, fromSignals } = tally;
  const observed = OUTCOME_SLOTS.filter((slot): slot is string => slot !== null);
  const notYet = counts[NULL_OUTCOME_KEY] ?? 0;
  return (
    <Panel className={styles.panel} aria-label="Outcomes">
      <SectionHead title="Outcomes" />
      <div className={styles.body}>
        <ul className={styles.tiles}>
          {observed.map((slot) => (
            <li
              key={slot}
              className={styles.tile}
              data-divergence={slot === ACQUIRED_BY_COMPETITOR || undefined}
            >
              <span className={styles.count}>{counts[slot] ?? 0}</span>
              <span className={styles.label}>{outcomeLabel(slot)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.quiet}>
          <span className={styles.mono}>{notYet}</span> {notYet === 1 ? "firm" : "firms"} with no
          outcome observed yet
        </p>
        {fromSignals > 0 && (
          <p className={styles.quiet}>
            <span className={styles.mono}>{fromSignals}</span>{" "}
            {fromSignals === 1 ? "outcome comes" : "outcomes come"} from{" "}
            {SYNTHETIC_LABEL.toLowerCase()}s, not from an analyst.
          </p>
        )}
        {passed > 0 && (
          <p className={styles.passed}>
            Of firms we passed, <b className={styles.mono}>{passedAndAcquired}</b>{" "}
            {passedAndAcquired === 1 ? "was" : "were"} later acquired. The drift loop exists to
            catch these.
          </p>
        )}
      </div>
    </Panel>
  );
}
