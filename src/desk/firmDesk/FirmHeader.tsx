import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { QualificationScore } from "@/data/ontology";
import { Chip, MonogramTile } from "@/ui";
import { MAX_POSSIBLE } from "../../../shared/scoreMirror";
import { normalizeLifecycle } from "../../../shared/vocab";
import { type ActiveConfigRule, computeHardScreen } from "../queue";
import { formatScore } from "../scoreFormat";
import { type MirrorResult } from "../scoreMirror";
import { TIER_LABEL, outcomeChipStyle, outcomeLabel } from "../tokens";
import styles from "./FirmHeader.module.css";
import { TierMeterBar } from "./TierMeterBar";
import { type FirmView, formatObservedDate } from "./deskModel";
import { priorScoreBefore } from "./priorScore";

// Observed-outcome chip. Rendered on the firm header when Firm.outcome is
// non-null. `acquired_by_competitor` renders in the divergence colour — that's
// the miss story the drift loop exists to catch. Null / unknown outcomes render
// nothing (the /accuracy panel handles the aggregate).
function OutcomeChip({
  outcome,
  observedAt,
}: {
  outcome: string | null | undefined;
  observedAt: unknown;
}): React.ReactElement | null {
  const raw = (outcome ?? "").trim();
  if (raw === "") {
    return null;
  }
  const style = outcomeChipStyle(raw);
  const label = outcomeLabel(raw);
  const dateStr = formatObservedDate(observedAt);
  const tooltip = dateStr === null ? `Outcome: ${label}` : `Outcome: ${label} · ${dateStr}`;
  return (
    <Chip
      title={tooltip}
      style={{ color: style.fg, background: style.bg, boxShadow: `0 0 0 1px ${style.border}` }}
    >
      Outcome: {label}
      {dateStr !== null && <span className={styles.dim}>· {dateStr}</span>}
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
    const verdict = computeHardScreen(
      { ...firm, firmId: firm.firmId ?? "" } as never,
      activeConfigs,
    );
    if (verdict.hardScreened) {
      return { hard: true, label: `Hard-rejected · ${verdict.reason ?? "screened"}` };
    }
  }
  return { hard: false, label: TIER_LABEL[tier] ?? tier };
}

/** Seconds the analyst has had this firm open; restarts when the firm changes. */
function useSecondsOnFirm(firmId: string | undefined): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [firmId]);
  return seconds;
}

/** The score the firm had before its last enrichment, from the persisted score history. */
function usePriorScore(firmId: string, enrichedAt: unknown): number | null {
  const { data } = useOsdkObjects(QualificationScore, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
    enabled: firmId !== "" && enrichedAt !== null && enrichedAt !== undefined,
  });
  return React.useMemo(
    () =>
      priorScoreBefore(
        (data ?? []) as unknown as Parameters<typeof priorScoreBefore>[0],
        enrichedAt,
      ),
    [data, enrichedAt],
  );
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
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  before: MirrorResult;
  after: MirrorResult;
  saving: boolean;
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
  const seconds = useSecondsOnFirm(firm.firmId);

  const enrichedAt = (firm as { enrichedAt?: unknown }).enrichedAt;
  const prior = usePriorScore(firm.firmId ?? "", enrichedAt);
  const delta = prior === null ? 0 : score - prior;

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
            outcome={(firm as unknown as { outcome?: string | null }).outcome}
            observedAt={(firm as unknown as { outcomeObservedAt?: unknown }).outcomeObservedAt}
          />
          <span className={styles.elapsed}>{seconds}s on firm</span>
        </div>
      </div>

      <div className={styles.scorebox}>
        <div className={styles.scoreRow}>
          <span
            className={`${styles.big} ${after.hardRejected ? styles.muted : ""}`}
            aria-label={formatScore(score)}
          >
            {score}
          </span>
          <span className={styles.of}>/ {MAX_POSSIBLE}</span>
          {delta !== 0 && (
            <span className={`${styles.delta} ${delta < 0 ? styles.down : ""}`}>
              {signed(delta)} since enrichment
            </span>
          )}
          <span
            className={`${styles.tier} ${tier === "Rejected" ? styles.tierRejected : ""}`}
            title={state.label}
          >
            {tier === "Rejected" ? "Rejected" : `Tier ${tier}`}
          </span>
        </div>
        {(saving || changed) && (
          <div className={styles.staged} role="status">
            <span className={styles.stagedDot} aria-hidden="true" />
            {saving ? "Saving…" : `${formatScore(beforeScore)} → ${formatScore(score)} staged`}
          </div>
        )}
        <TierMeterBar score={score} model={after.model} prior={prior} />
      </div>
    </div>
  );
}
