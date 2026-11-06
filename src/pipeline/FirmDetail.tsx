import React from "react";
import { Term } from "@/components/Term";
import { formatObservedDate } from "@/desk/firmDesk/deskModel";
import { scoreFraction } from "@/desk/scoreFormat";
import { TIER_COLOR, TIER_LABEL, outcomeChipStyle, outcomeLabel } from "@/desk/tokens";
import { Button, ButtonLink, Chip } from "@/ui";
import { SYNTHETIC_LABEL } from "../../shared/marketSignals";
import { MAX_POSSIBLE } from "../../shared/scoreMirror";
import { LIFECYCLE_STAGES, MARKET_SIGNAL } from "../../shared/vocab";
import styles from "./FirmDetail.module.css";
import { StageChip } from "./chips";
import { type Row, activityText, firmFacts, isOut, rejectText } from "./pipelineModel";

function OutcomeChip({
  outcome,
  observedAt,
  source,
}: {
  outcome: string;
  observedAt: unknown;
  /** Who reported it: a synthetic market signal is named on the chip. */
  source?: string | null;
}): React.ReactElement {
  const style = outcomeChipStyle(outcome);
  const label = outcomeLabel(outcome);
  const date = formatObservedDate(observedAt);
  const synthetic = source === MARKET_SIGNAL;
  return (
    <Chip
      title={[`Outcome: ${label}`, date, synthetic ? SYNTHETIC_LABEL : null]
        .filter(Boolean)
        .join(" · ")}
      style={{ color: style.fg, background: style.bg, boxShadow: `0 0 0 1px ${style.border}` }}
    >
      Outcome: {label}
      {date !== null && <span className={styles.dim}>· {date}</span>}
      {synthetic && <span className={styles.dim}>· {SYNTHETIC_LABEL}</span>}
    </Chip>
  );
}

/** The firm in full: its profile, where it sits in the funnel, how it scores and why it is out. */
export function FirmDetail({
  row,
  showName,
  now,
  onClose,
}: {
  row: Row;
  /** False in the drawer, whose title already names the firm. */
  showName: boolean;
  now: number;
  /** Closes the panel; the drawer has its own close button, so only the column passes this. */
  onClose?: () => void;
}): React.ReactElement {
  const { firm, mirror, score, bucket, rejectionRationale, lastActivity } = row;
  const out = isOut(row);
  const tierColor = TIER_COLOR[score.tier] ?? TIER_COLOR.Rejected;
  const tierNote = mirror.hardRejected
    ? "Hard-rejected by the screen"
    : score.tier === "Rejected"
      ? "Below the C threshold"
      : (TIER_LABEL[score.tier] ?? "");
  const facts = firmFacts(firm);
  const stageIndex = (LIFECYCLE_STAGES as readonly string[]).indexOf(bucket);

  return (
    <div className={styles.detail}>
      <div>
        {(showName || onClose !== undefined) && (
          <div className={styles.titleRow}>
            {showName && <h2 className={styles.name}>{firm.firmName ?? firm.firmId}</h2>}
            {onClose !== undefined && (
              <Button variant="ghost" onClick={onClose} aria-label="Close details">
                Close
              </Button>
            )}
          </div>
        )}
        <div className={styles.meta}>
          <StageChip stage={bucket} />
          {firm.firmType && <Chip>{firm.firmType}</Chip>}
          {firm.sector && <Chip>{firm.sector}</Chip>}
          {firm.hqCountry && <span className={styles.hq}>{firm.hqCountry}</span>}
        </div>
        {firm.outcome && firm.outcome.trim() !== "" && (
          <div className={styles.outcome}>
            <OutcomeChip
              outcome={firm.outcome}
              observedAt={firm.outcomeObservedAt}
              source={firm.outcomeSource}
            />
          </div>
        )}
      </div>

      <section aria-label="Qualification status">
        <h3 className={styles.kicker}>
          Qualification status <span>(read-only)</span>
        </h3>
        <ol className={styles.track}>
          {LIFECYCLE_STAGES.map((s, i) => (
            <li
              key={s}
              data-state={i < stageIndex ? "done" : i === stageIndex ? "now" : "next"}
              aria-current={i === stageIndex ? "step" : undefined}
            >
              {s}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.scorebox} aria-label="Fit score">
        <div className={styles.scoreRow}>
          <span className={styles.big} style={{ color: tierColor }}>
            {score.total}
          </span>
          <span className={styles.of}>/ {MAX_POSSIBLE}</span>
          <span className={styles.tier} style={{ color: tierColor }}>
            Tier {score.tier === "Rejected" ? "below C" : score.tier}
          </span>
        </div>
        <span className={styles.bar} aria-hidden="true">
          <span style={{ width: `${scoreFraction(score.total) * 100}%`, background: tierColor }} />
        </span>
        <span className={styles.note}>{tierNote}</span>
      </section>

      {out && <div className={styles.reject}>{rejectText(mirror, rejectionRationale)}</div>}

      <section aria-label="Firm facts">
        <h3 className={styles.kicker}>Firm facts</h3>
        <dl className={styles.facts}>
          {facts.map((f) => (
            <React.Fragment key={f.label}>
              <dt>{f.label === "Coverage" ? <Term id="Coverage">Coverage</Term> : f.label}</dt>
              <dd>{f.value}</dd>
            </React.Fragment>
          ))}
          <dt>Last activity</dt>
          <dd>{activityText(lastActivity, now)}</dd>
        </dl>
      </section>

      <div className={styles.actions}>
        {!out && (
          <ButtonLink
            to={`/desk?firmId=${encodeURIComponent(firm.firmId ?? "")}`}
            variant="primary"
          >
            Open in enrichment desk
          </ButtonLink>
        )}
        <ButtonLink to={`/firm/${encodeURIComponent(firm.firmId ?? "")}/tear-sheet`}>
          Tear sheet
        </ButtonLink>
      </div>
    </div>
  );
}
