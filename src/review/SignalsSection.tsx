import React from "react";
import { Link } from "react-router-dom";
import { SectionHead } from "@/home/SectionHead";
import { Chip, Panel } from "@/ui";
import styles from "./SignalsSection.module.css";
import { type SignalsView } from "./signalsModel";

/**
 * The market signals applied lately, newest first. They are invented: every row carries the
 * "Synthetic market signal" label, and the panel says what they are before it lists any.
 */
export function SignalsSection({
  view,
  loading,
}: {
  view: SignalsView;
  loading: boolean;
}): React.ReactElement {
  return (
    <Panel className={styles.panel} aria-label="Signals" data-testid="signals">
      <SectionHead title="Signals" count={loading ? undefined : view.total} />
      <p className={styles.note}>
        Synthetic market signals are invented news (a hire, a departure, a deal, an acquisition)
        that Beacon applies hourly. They move scores, and a decided firm that moves comes back here
        as drift.
      </p>
      {!loading && view.rows.length === 0 && (
        <p className={styles.empty}>No market signal has been applied yet.</p>
      )}
      <ul className={styles.list}>
        {view.rows.map((r) => (
          <li key={r.id} className={styles.row} data-signal={r.id}>
            <div className={styles.main}>
              <p className={styles.headline}>{r.headline}</p>
              <p className={styles.meta}>
                <Link
                  className={styles.firm}
                  to={`/firm/${encodeURIComponent(r.firmId)}/tear-sheet`}
                >
                  {r.firmName}
                </Link>
                <span>{r.kind}</span>
                <span>{r.moved}</span>
                <Chip>{r.label}</Chip>
              </p>
            </div>
            <time className={styles.age} dateTime={r.date} title={r.date}>
              {r.age}
            </time>
          </li>
        ))}
      </ul>
      {view.total > view.rows.length && (
        <p className={styles.more}>
          Showing the newest {view.rows.length} of {view.total}.
        </p>
      )}
    </Panel>
  );
}
