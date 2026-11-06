import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { QualificationScore, ReviewDecision } from "@/data/ontology";
import { MAX_POSSIBLE } from "../../../shared/scoreMirror";
import { DecisionMemory } from "./DecisionMemory";
import styles from "./HistoryTab.module.css";
import { type FirmView } from "./deskModel";
import { firmDecisions } from "./firmDecisions";
import { scoreHistory } from "./scoreHistory";

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const signed = (n: number): string => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

/** The History tab: past decisions on similar firms, this firm's own decisions and why, and how its score has moved. */
export function HistoryTab({
  firm,
  allFirms,
  firmsLoading,
}: {
  firm: FirmView;
  allFirms: FirmView[];
  firmsLoading: boolean;
}): React.ReactElement {
  const firmId = firm.firmId ?? "";
  const { data, isLoading } = useOsdkObjects(QualificationScore, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
    enabled: firmId !== "",
  });
  const history = React.useMemo(
    () => scoreHistory((data ?? []) as unknown as Parameters<typeof scoreHistory>[0]),
    [data],
  );

  const decisionQuery = useOsdkObjects(ReviewDecision, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
    enabled: firmId !== "",
  });
  const decisions = React.useMemo(
    () =>
      firmDecisions((decisionQuery.data ?? []) as unknown as Parameters<typeof firmDecisions>[0]),
    [decisionQuery.data],
  );

  return (
    <div className={styles.history}>
      <section aria-label="Decision memory">
        <h3 className={styles.head}>Past decisions on similar firms</h3>
        <DecisionMemory
          firm={firm}
          allFirms={allFirms}
          firmsLoading={firmsLoading}
          empty={<p className={styles.empty}>No decisions on similar firms yet.</p>}
        />
      </section>
      <section aria-label="Decisions on this firm">
        <h3 className={styles.head}>Decisions on this firm</h3>
        {decisions.length === 0 ? (
          <p className={styles.empty}>
            {decisionQuery.isLoading ? "Loading…" : "No one has made a decision on this firm yet."}
          </p>
        ) : (
          <ol className={styles.decisions}>
            {decisions.map((d) => (
              <li key={d.id || d.at}>
                <div className={styles.decisionRow}>
                  <span className={`${styles.decision} ${d.rejected ? styles.rejected : ""}`}>
                    {d.label}
                  </span>
                  {d.score !== null && (
                    <span className={styles.total}>
                      {d.score} / {MAX_POSSIBLE}
                    </span>
                  )}
                  <span className={styles.when}>{stamp(d.at)}</span>
                </div>
                {d.rationale !== null && <p className={styles.rationale}>{d.rationale}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="Score history">
        <h3 className={styles.head}>Score history</h3>
        {history.length === 0 ? (
          <p className={styles.empty}>
            {isLoading ? "Loading…" : "No score has been recorded for this firm yet."}
          </p>
        ) : (
          <ol className={styles.scores}>
            {history.slice(0, 8).map((s) => (
              <li key={s.id || s.at}>
                <span className={styles.when}>{stamp(s.at)}</span>
                <span className={styles.total}>
                  {s.total} / {MAX_POSSIBLE}
                </span>
                {s.change !== null && s.change !== 0 && (
                  <span className={s.change > 0 ? styles.up : styles.down}>{signed(s.change)}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
