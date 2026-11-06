import React from "react";
import { normalizeLifecycle } from "../../../shared/vocab";
import { type ActiveConfigRule, computeHardScreen } from "../queue";
import { formatScore } from "../scoreFormat";
import { type MirrorResult } from "../scoreMirror";
import { TIER_COLOR, TIER_LABEL, outcomeChipStyle, outcomeLabel } from "../tokens";
import { type FirmView, formatObservedDate } from "./deskModel";

// Observed-outcome chip. Rendered on the firm header and the pipeline
// detail rail when Firm.outcome is non-null. `acquired_by_competitor`
// renders in muted red — that's the miss story the drift loop exists to
// catch. Null / unknown outcomes render nothing (there's no useful chip
// for "not yet observed" on a single firm — the /accuracy panel handles
// that aggregate).
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
    <span
      className="tag"
      title={tooltip}
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: style.fg,
        background: style.bg,
        border: `1px solid ${style.border}`,
        fontWeight: 500,
      }}
    >
      Outcome: {label}
      {dateStr !== null && (
        <span style={{ opacity: 0.75, marginLeft: 6, fontWeight: 400 }}>· {dateStr}</span>
      )}
    </span>
  );
}

// Tier tag — accent-tinted 16% bg, tier-colored text.
export function TierTag({ tier }: { tier: string }): React.ReactElement {
  const c = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  return (
    <span
      className="tag"
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: c,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
      }}
    >
      {tier === "Rejected" ? "R" : tier}
    </span>
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
// for the header state string and delegates the hard-screen verdict to
// the shared computeHardScreen so the queue and header can't disagree.
function headerStateLabel(
  firm: FirmView,
  after: MirrorResult,
  tier: string,
  activeConfigs: readonly ActiveConfigRule[],
  configsLoading: boolean,
): string {
  // Base-rule verdict is client-computable and reflects edits in progress,
  // so render it immediately without waiting on the HardScreenConfig query.
  if (after.hardRejected) {
    return `Hard-rejected · ${after.rejectReason || "base rule"}`;
  }
  // Config checks depend on the HardScreenConfig query — avoid a false
  // "Hard-rejected" flicker by falling back to the tier label
  // until the query resolves. Once configs land, the shared verdict wins.
  if (configsLoading) {
    return TIER_LABEL[tier] ?? tier;
  }
  const verdict = computeHardScreen({ ...firm, firmId: firm.firmId ?? "" } as never, activeConfigs);
  if (verdict.hardScreened) {
    return `Hard-rejected · ${verdict.reason ?? "screened"}`;
  }
  return TIER_LABEL[tier] ?? tier;
}

export function FirmHeader({
  firm,
  before,
  after,
  elapsed,
  saving,
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  before: MirrorResult;
  after: MirrorResult;
  elapsed: number;
  saving: boolean;
  activeConfigs: readonly ActiveConfigRule[];
  configsLoading: boolean;
}): React.ReactElement {
  const tier = after.tier;
  const tierColor = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  const status = normalizeLifecycle(firm.lifecycleState ?? firm.currentStage);
  // A hard reject scores 0 (the mirror's weightedTotal), shown muted beside the R tag.
  const score = after.weightedTotal;
  const beforeScore = before.weightedTotal;
  const changed = score !== beforeScore;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 500,
              overflowWrap: "anywhere",
              textDecorationLine: after.hardRejected ? "line-through" : "none",
              textDecorationColor: "color-mix(in srgb, var(--color-text) 40%, transparent)",
            }}
          >
            {firm.firmName ?? firm.firmId}
          </h3>
          <span
            className="tag"
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: "var(--radius-chip)",
              color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
              background: "var(--color-neutral-800)",
            }}
          >
            {status}
          </span>
          <span className="tag tag-neutral" style={{ fontWeight: 600 }}>
            {after.model}
          </span>
          <OutcomeChip
            outcome={(firm as unknown as { outcome?: string | null }).outcome}
            observedAt={(firm as unknown as { outcomeObservedAt?: unknown }).outcomeObservedAt}
          />
        </div>
        {(firm.sector || firm.coverageModel || firm.hqCountry) && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              fontSize: 13,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
          >
            {firm.sector && <span className="tag tag-outline">{firm.sector}</span>}
            {firm.coverageModel && <span>{firm.coverageModel}</span>}
            {firm.hqCountry && (
              <>
                {firm.coverageModel && <span style={{ opacity: 0.4 }}>·</span>}
                <span>{firm.hqCountry}</span>
              </>
            )}
          </div>
        )}
        {(firm.revenueBand || firm.ownership || firm.successionRisk) && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 14,
              marginTop: 6,
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
          >
            {firm.revenueBand && <span>Revenue {firm.revenueBand}</span>}
            {firm.ownership && <span>{firm.ownership}</span>}
            {firm.successionRisk && <span>{firm.successionRisk} succession risk</span>}
          </div>
        )}
      </div>
      <div style={{ flex: "none", textAlign: "right" }}>
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}
        >
          <span
            style={{
              fontSize: 44,
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: after.hardRejected
                ? "color-mix(in srgb, var(--color-text) 40%, transparent)"
                : tierColor,
            }}
          >
            {formatScore(score)}
          </span>
          <TierTag tier={tier} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          {saving && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--color-accent)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
              Saving…
            </span>
          )}
          {changed && !saving && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--color-accent)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
              {formatScore(beforeScore)} → {formatScore(score)}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
            }}
          >
            {headerStateLabel(firm, after, tier, activeConfigs, configsLoading)} · {elapsed}s on
            firm
          </span>
        </div>
      </div>
    </div>
  );
}
