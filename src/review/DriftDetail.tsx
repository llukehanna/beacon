import React from "react";
import { Term } from "@/components/Term";
import { parseChangedAxes, resolutionLabel } from "@/desk/driftReview";
import { formatScore } from "@/desk/scoreFormat";
import { TIER_COLOR, isOutcomeDivergence, outcomeLabel } from "@/desk/tokens";
import { Button } from "@/ui";
import { DriftActions } from "./DriftActions";
import styles from "./DriftDetail.module.css";
import { type DriftItem, agoText, formatChangeValue, reasonStyle } from "./driftModel";

function TierBadge({
  tier,
  score,
}: {
  tier: string;
  score: number | null | undefined;
}): React.ReactElement {
  const color = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  return (
    <span className={styles.badge} style={{ "--tier": color } as React.CSSProperties}>
      {score !== null && score !== undefined ? formatScore(score, tier) : tier}
    </span>
  );
}

/**
 * One drift event in full: the tier it moved between, why it surfaced, what changed, any passed
 * firms that share a now-stale reason, and the decisions on offer.
 */
export function DriftDetail({
  item,
  showName,
  now,
  onClose,
}: {
  item: DriftItem;
  /** False in the drawer, whose title already names the firm. */
  showName: boolean;
  now: number;
  /** Closes the panel; the drawer has its own close button, so only a column that can close passes this. */
  onClose?: () => void;
}): React.ReactElement {
  const { drift, resolved, lookalikes } = item;
  const [lookalikesOpen, setLookalikesOpen] = React.useState(false);
  const reason = reasonStyle(drift);
  const divergence = isOutcomeDivergence(drift.driftReason);
  const changed = React.useMemo(() => parseChangedAxes(drift.changedAxes), [drift.changedAxes]);
  const firstChange = changed[0];
  const detected = agoText(drift.detectedAt, now);

  return (
    <div className={styles.detail}>
      <div>
        {(showName || onClose !== undefined) && (
          <div className={styles.titleRow}>
            {showName && <h2 className={styles.name}>{item.firmName}</h2>}
            {onClose !== undefined && (
              <Button variant="ghost" onClick={onClose} aria-label="Close details">
                Close
              </Button>
            )}
          </div>
        )}
        <div className={styles.meta}>
          <span className={styles.reasonChip} style={{ color: reason.fg, background: reason.bg }}>
            {reason.label}
          </span>
          {detected !== null && <span className={styles.when}>Detected {detected}</span>}
          {resolved && (
            <span className={styles.resolved}>
              {resolutionLabel(drift.resolution, item.firmGone)}
            </span>
          )}
        </div>
      </div>

      <section className={styles.tiers} aria-label="Tier change">
        <h3 className={styles.kicker}>
          <Term id="Tier">Tier</Term>
        </h3>
        <div className={styles.move}>
          <div>
            <span className={styles.lab}>At decision</span>
            <TierBadge tier={drift.priorTier ?? "?"} score={drift.priorScore ?? null} />
          </div>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <div>
            <span className={styles.lab}>Now</span>
            <TierBadge tier={drift.newTier ?? "?"} score={drift.newScore ?? null} />
          </div>
        </div>
      </section>

      {!resolved && divergence && (
        <section
          className={styles.quote}
          style={{ borderColor: reason.border }}
          aria-label="Why it surfaced"
        >
          <div>
            <h3 className={styles.kicker}>We passed because</h3>
            <p className={styles.why}>
              {item.rejectionReason !== null
                ? `“${item.rejectionReason.trim()}”`
                : "no rationale on file"}
            </p>
          </div>
          <div>
            <h3 className={styles.kicker}>{item.firmGone ? "Later" : "Market observed"}</h3>
            <p className={styles.observed}>{outcomeLabel(item.observedOutcome)}</p>
            {firstChange?.source && <p className={styles.source}>{firstChange.source}</p>}
          </div>
        </section>
      )}

      {!resolved && !divergence && firstChange && (
        <section className={styles.quote} aria-label="What changed">
          <p className={styles.why}>
            {firstChange.axis ?? "unknown axis"}: {formatChangeValue(firstChange.old)} →{" "}
            {formatChangeValue(firstChange.new)}
          </p>
          {firstChange.source && (
            <p className={styles.source}>
              <span>{firstChange.source}</span>
            </p>
          )}
          {changed.length > 1 && (
            <p className={styles.source}>
              +{changed.length - 1} more axis change{changed.length > 2 ? "s" : ""}
            </p>
          )}
        </section>
      )}

      {!resolved && lookalikes.total > 0 && (
        <div>
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setLookalikesOpen((v) => !v)}
            aria-expanded={lookalikesOpen}
            title="Other passed firms whose rejection reason cites the axis that invalidated this firm's reason"
          >
            {lookalikesOpen
              ? "Hide"
              : `+${lookalikes.total} passed firm${lookalikes.total === 1 ? "" : "s"} share this now-stale reason`}
          </button>
          {lookalikesOpen && (
            <div className={styles.lookalikes}>
              {lookalikes.firms.map((l) => (
                <span key={l.firmId} className={styles.firmChip} title={l.firmId}>
                  {l.firmName}
                </span>
              ))}
              {lookalikes.total > lookalikes.firms.length && (
                <span className={styles.more}>
                  and {lookalikes.total - lookalikes.firms.length} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!resolved && <DriftActions item={item} />}
    </div>
  );
}
