import React from "react";
import { Link } from "react-router-dom";
import { Term } from "@/components/Term";
import { useOsdkObjects } from "@/data/hooks";
import { QualificationScore } from "@/data/ontology";
import { FROM_DESK } from "@/shell/origin";
import { Chip, MonogramTile } from "@/ui";
import { SYNTHETIC_LABEL } from "../../../shared/marketSignals";
import { MAX_POSSIBLE, TIER_THRESHOLDS } from "../../../shared/scoreMirror";
import { MARKET_SIGNAL, normalizeLifecycle } from "../../../shared/vocab";
import { type ActiveConfigRule, computeHardScreen } from "../queue";
import { formatScore } from "../scoreFormat";
import { type MirrorResult } from "../scoreMirror";
import { TIER_LABEL, outcomeChipStyle, outcomeLabel } from "../tokens";
import styles from "./FirmHeader.module.css";
import { TierMeterBar } from "./TierMeterBar";
import { type FirmView, formatObservedDate } from "./deskModel";
import { enrichmentDelta, priorScoreBefore } from "./priorScore";
import { type Projection } from "./projection";
import { belowCGloss, tierText } from "./tierMeter";

// Observed-outcome chip. Rendered on the firm header when Firm.outcome is
// non-null. `acquired_by_competitor` renders in the divergence colour — that's
// the miss story the drift loop exists to catch. Null / unknown outcomes render
// nothing (the /accuracy panel handles the aggregate).
function OutcomeChip({
  outcome,
  observedAt,
  source,
}: {
  outcome: string | null | undefined;
  observedAt: unknown;
  /** Who reported it: a synthetic market signal is named on the chip. */
  source?: string | null;
}): React.ReactElement | null {
  const raw = (outcome ?? "").trim();
  if (raw === "") {
    return null;
  }
  const style = outcomeChipStyle(raw);
  const label = outcomeLabel(raw);
  const dateStr = formatObservedDate(observedAt);
  const synthetic = source === MARKET_SIGNAL;
  const tooltip = [`Outcome: ${label}`, dateStr, synthetic ? SYNTHETIC_LABEL : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Chip
      title={tooltip}
      style={{ color: style.fg, background: style.bg, boxShadow: `0 0 0 1px ${style.border}` }}
    >
      Outcome: {label}
      {dateStr !== null && <span className={styles.dim}>· {dateStr}</span>}
      {synthetic && <span className={styles.dim}>· {SYNTHETIC_LABEL}</span>}
    </Chip>
  );
}

// Three distinct states the header must not conflate:
//   • Hard-rejected — the *system* screened the firm out (client base rule
//     or server-side approved HardScreenConfig row). Shows the reason.
//   • Passed — soft state: analyst passed (lifecycleState=Passed)
//     or the weighted score fell below C. Enrichment can still move it.
//   • Otherwise — the tier label (Strong / Moderate / Weak).
// TIER_LABEL used to spell "Hard-rejected" for the Rejected tier, so any
// low-score firm (like Aspect at 4 employees) read as a hard reject even
// when no screen ever fired. This helper is the single source of truth
// for the header state and delegates the hard-screen verdict to the
// shared computeHardScreen so the queue and header can't disagree.
function headerState(
  firm: FirmView,
  after: MirrorResult,
  tier: string,
  activeConfigs: readonly ActiveConfigRule[],
  configsLoading: boolean,
): { hard: boolean; label: string } {
  // Base-rule verdict is client-computable and reflects edits in progress,
  // so render it immediately without waiting on the HardScreenConfig query.
  if (after.hardRejected) {
    return { hard: true, label: `Hard-rejected · ${after.rejectReason || "base rule"}` };
  }
  // Config checks depend on the HardScreenConfig query — avoid a false
  // "Hard-rejected" flicker by falling back to the tier label
  // until the query resolves. Once configs land, the shared verdict wins.
  if (!configsLoading) {
    const verdict = computeHardScreen({ ...firm, firmId: firm.firmId ?? "" }, activeConfigs);
    if (verdict.hardScreened) {
      return { hard: true, label: `Hard-rejected · ${verdict.reason ?? "screened"}` };
    }
  }
  return { hard: false, label: TIER_LABEL[tier] ?? tier };
}

/** The score the firm had before its last enrichment, from the persisted score history. */
function usePriorScore(firmId: string, enrichedAt: unknown): number | null {
  const { data } = useOsdkObjects(QualificationScore, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
    enabled: firmId !== "" && enrichedAt !== null && enrichedAt !== undefined,
  });
  return React.useMemo(() => priorScoreBefore(data ?? [], enrichedAt), [data, enrichedAt]);
}

const signed = (n: number): string => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

/** The facts the firm record actually has, as chips; nothing is shown for a missing field. */
function factChips(firm: FirmView): string[] {
  const facts: (string | null)[] = [
    firm.sector || null,
    firm.coverageModel || null,
    firm.hqCountry || null,
    typeof firm.employees === "number" ? `${firm.employees} staff` : null,
    typeof firm.firmAge === "number" ? `${firm.firmAge} yrs old` : null,
    firm.revenueBand ? `Revenue ${firm.revenueBand}` : null,
    firm.ownership || null,
    firm.successionRisk ? `${firm.successionRisk} succession risk` : null,
  ];
  return facts.filter((f): f is string => f !== null);
}

export function FirmHeader({
  firm,
  before,
  after,
  saving,
  projection,
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  before: MirrorResult;
  after: MirrorResult;
  saving: boolean;
  /** The score if the open proposals were verified; null when none is open. */
  projection: Projection | null;
  activeConfigs: readonly ActiveConfigRule[];
  configsLoading: boolean;
}): React.ReactElement {
  const tier = after.tier;
  const status = normalizeLifecycle(firm.lifecycleState ?? firm.currentStage);
  const name = firm.firmName ?? firm.firmId ?? "";
  // A hard reject scores 0 (the mirror's weightedTotal), shown muted.
  const score = after.weightedTotal;
  const beforeScore = before.weightedTotal;
  const changed = score !== beforeScore;
  const state = headerState(firm, after, tier, activeConfigs, configsLoading);
  const belowC = belowCGloss(tier, state.hard, TIER_THRESHOLDS[after.model].C, MAX_POSSIBLE);

  const prior = usePriorScore(firm.firmId ?? "", firm.enrichedAt);
  // The change the last enrichment made is between two stored scores, so it is read from the
  // stored firm (not the staged edits), and a hard-rejected firm's zero is not a change.
  const delta = enrichmentDelta(before.weightedTotal, prior, state.hard || before.hardRejected);

  return (
    <div className={styles.hero}>
      <MonogramTile name={name} />
      <div className={styles.identity}>
        <h1 className={`${styles.name} ${after.hardRejected ? styles.struck : ""}`}>{name}</h1>
        <div className={styles.meta}>
          {factChips(firm).map((fact) => (
            <Chip key={fact}>{fact}</Chip>
          ))}
          <Chip title="Lifecycle stage">{status}</Chip>
          <Chip title="Rubric model">{after.model}</Chip>
          {state.hard && <Chip className={styles.hardChip}>{state.label}</Chip>}
          <OutcomeChip
            outcome={firm.outcome}
            observedAt={firm.outcomeObservedAt}
            source={firm.outcomeSource}
          />
          {firm.firmId && (
            <Link
              to={`/firm/${encodeURIComponent(firm.firmId)}/tear-sheet`}
              state={FROM_DESK}
              className={styles.sheetLink}
            >
              Tear sheet
            </Link>
          )}
        </div>
      </div>

      <div className={styles.scorebox}>
        <div className={styles.scoreRow}>
          <span className={`${styles.big} ${after.hardRejected ? styles.muted : ""}`}>
            <span aria-hidden="true">{score}</span>
            <span className="sr-only">{formatScore(score)}</span>
          </span>
          <span className={styles.of} aria-hidden="true">
            / {MAX_POSSIBLE}
          </span>
          {delta !== 0 && (
            <span className={`${styles.delta} ${delta < 0 ? styles.down : ""}`}>
              {signed(delta)} since enrichment
            </span>
          )}
          <span
            className={`${styles.tier} ${tier === "Rejected" ? styles.tierRejected : ""}`}
            title={belowC === null ? state.label : undefined}
          >
            {belowC === null ? (
              tierText(tier, state.hard)
            ) : (
              <Term id="below-c" definition={belowC}>
                {tierText(tier, state.hard)}
              </Term>
            )}
          </span>
        </div>
        {(saving || changed) && (
          <div className={styles.staged} role="status">
            <span className={styles.stagedDot} aria-hidden="true" />
            {saving ? "Saving…" : `${formatScore(beforeScore)} → ${formatScore(score)} staged`}
          </div>
        )}
        <TierMeterBar score={score} model={after.model} prior={prior} hard={state.hard} />
        {projection !== null &&
          !state.hard &&
          (projection.hardRejected ? (
            <div className={styles.projection} data-testid="projected-score">
              <span>
                Would be hard-rejected if the {projection.count} proposal
                {projection.count === 1 ? " is" : "s are"} verified
                {projection.rejectReason === "" ? "" : `: ${projection.rejectReason}`}
              </span>
            </div>
          ) : (
            <div className={styles.projection} data-testid="projected-score">
              <span>
                If {projection.count} proposal{projection.count === 1 ? "" : "s"} verified
              </span>
              <span className={styles.projected}>
                <b>{projection.score}</b> / {MAX_POSSIBLE} · {tierText(projection.tier, false)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
