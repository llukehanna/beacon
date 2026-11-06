import React from "react";
import DemoFooter from "@/components/DemoFooter";
import { Term } from "@/components/Term";
import { useOsdkAction, useOsdkObjects } from "@/data/hooks";
import {
  DriftEvent,
  Firm,
  ReviewDecision,
  acknowledgeDriftAction,
  keepPassedAction,
  reEngageFirmAction,
  rejectFirmAction,
} from "@/data/ontology";
import { PASSED, isQualifiedOrLater, normalizeLifecycle } from "../../shared/vocab";
import { lookalikesFor, parseChangedAxes, reasonText, resolutionLabel } from "./driftReview";
import { BrandMark, WorkspaceNavLinks } from "./nav";
import "./nocturne.css";
import { latestRejection } from "./pipelineRows";
import { formatScore } from "./scoreFormat";
import {
  DIVERGENCE_FG,
  type DriftReasonStyle,
  SIDEBAR_STYLE,
  TIER_COLOR,
  VOID_BG,
  driftReasonPresentation,
  isOutcomeDivergence,
  outcomeLabel,
} from "./tokens";

interface FirmLike {
  firmId?: string;
  firmName?: string | null;
  lifecycleState?: string | null;
  // FDE backfills these on decided firms; not yet in the SDK PropertyKeys
  // for Firm — same widened-cast pattern the desk uses.
  outcome?: string | null;
  outcomeObservedAt?: string | number | Date | null;
}

interface Lookalike {
  firmId: string;
  firmName: string;
}

interface LookalikeSet {
  firms: Lookalike[];
  total: number;
}

const NO_LOOKALIKES: LookalikeSet = { firms: [], total: 0 };

// ─── Reason vocabulary ──────────────────────────────────────────────────
// Matches support.js:reasonMap in the design. The palette itself lives in
// ./tokens (DRIFT_REASON_STYLE) so /review and Home render the same violet.

const reasonPresentation = (raw: string | undefined): DriftReasonStyle =>
  driftReasonPresentation(raw);

// ─── Primitives ─────────────────────────────────────────────────────────

function Kicker({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

function TierBadge({
  tier,
  score,
}: {
  tier: string;
  score: number | null | undefined;
}): React.ReactElement {
  const c = TIER_COLOR[tier] ?? TIER_COLOR.Rejected;
  const label = score !== null && score !== undefined ? formatScore(score, tier) : tier;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "var(--radius-chip)",
        color: c,
        background: `color-mix(in srgb, ${c} 15%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function relativeTime(ts: unknown): string {
  if (ts === null || ts === undefined) {
    return "";
  }
  const d = typeof ts === "string" || typeof ts === "number" ? new Date(ts) : (ts as Date);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) {
    return "";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

// ─── Drift card ─────────────────────────────────────────────────────────

interface DriftLike {
  driftEventId: string;
  firmId?: string;
  changedAxes?: string;
  detectedAt?: unknown;
  driftReason?: string;
  driftStatus?: string;
  newScore?: number;
  newTier?: string;
  priorScore?: number;
  priorTier?: string;
  resolution?: string;
  resolvedAt?: unknown;
  resolvedBy?: string;
}

function DriftCard({
  drift,
  firmName,
  firmObj,
  lookalikes,
  rejectionReason,
  observedOutcome,
  explainTier = false,
}: {
  // True on the one card per page that wraps "Tier" in a glossary tooltip.
  explainTier?: boolean;
  drift: DriftLike;
  firmName: string;
  firmObj: unknown;
  lookalikes: LookalikeSet;
  // Only populated when the drift is outcome_diverged — the parent looks
  // both up (most-recent ReviewDecision + Firm.outcome). Passing null when
  // unknown so the card can degrade to a generic body if either is missing.
  rejectionReason?: string | null;
  observedOutcome?: string | null;
}): React.ReactElement {
  const reEngage = useOsdkAction(reEngageFirmAction);
  const keepPassed = useOsdkAction(keepPassedAction);
  const acknowledge = useOsdkAction(acknowledgeDriftAction);
  const pass = useOsdkAction(rejectFirmAction);
  const [notePanel, setNotePanel] = React.useState<"keepPassed" | "pass" | null>(null);
  const [lookalikesOpen, setLookalikesOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  const resolved = (drift.driftStatus ?? "").toLowerCase() === "resolved";
  const reason = reasonPresentation(drift.driftReason);
  const divergence = isOutcomeDivergence(drift.driftReason);
  const changed = React.useMemo(() => parseChangedAxes(drift.changedAxes), [drift.changedAxes]);
  const firstChange = changed[0];

  // Passed firms are offered a way back in; firms still in the pipeline a
  // way to stay or go. Nothing until the firm has loaded.
  const lifecycle = (firmObj as FirmLike | undefined)?.lifecycleState;
  const kind: "passed" | "pipeline" | null =
    firmObj === undefined
      ? null
      : normalizeLifecycle(lifecycle) === PASSED
        ? "passed"
        : isQualifiedOrLater(normalizeLifecycle(lifecycle))
          ? "pipeline"
          : null;

  // A Closed firm is done: nothing left to pass on, only the drift to note.
  const canPass = normalizeLifecycle(lifecycle) !== "Closed";

  const closeNotePanel = (): void => {
    setNote("");
    setNotePanel(null);
  };
  const onReEngage = (): void => {
    void reEngage.applyAction({ firm: firmObj, driftEvent: drift } as never);
  };
  const onAcknowledge = (): void => {
    void acknowledge.applyAction({ driftEvent: drift, note: null } as never);
  };
  const onKeepPassed = (): void => {
    void keepPassed
      .applyAction({ driftEvent: drift, rationale: note.trim() } as never)
      .then(closeNotePanel);
  };
  const onPass = (): void => {
    void pass
      .applyAction({ firm: firmObj, rejectionRationale: note.trim() } as never)
      .then(closeNotePanel);
  };

  const noteSubmitting = notePanel === "keepPassed" ? keepPassed.isPending : pass.isPending;
  const canSubmitNote = note.trim().length > 0 && !noteSubmitting;
  const busy = reEngage.isPending || acknowledge.isPending || noteSubmitting;
  const failures: string[] = [
    reEngage.error !== undefined ? `Re-engage failed: ${String(reEngage.error)}` : "",
    acknowledge.error !== undefined ? `Keep in pipeline failed: ${String(acknowledge.error)}` : "",
    keepPassed.error !== undefined
      ? `Keep passed failed: ${String(keepPassed.error)}. Your note is preserved.`
      : "",
    pass.error !== undefined ? `Pass failed: ${String(pass.error)}. Your note is preserved.` : "",
  ].filter((m) => m !== "");

  const priorTierName = drift.priorTier ?? "?";
  const newTierName = drift.newTier ?? "?";

  return (
    <div
      style={{
        padding: "15px 16px",
        border: "1px solid var(--color-divider)",
        // Left rail picks up the reason color so the analyst can scan the
        // queue by trigger without reading each chip. Muted so it doesn't
        // fight the tier badges in the header row.
        borderLeft: `3px solid ${reason.border}`,
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
        opacity: resolved ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: 16,
            overflowWrap: "anywhere",
            color: resolved ? "color-mix(in srgb, var(--color-text) 55%, transparent)" : "inherit",
          }}
        >
          {firmName}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            }}
          >
            {explainTier ? <Term id="Tier">Tier</Term> : "Tier"}
          </span>
          <TierBadge tier={priorTierName} score={drift.priorScore ?? null} />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="color-mix(in srgb, var(--color-text) 45%, transparent)"
            strokeWidth={2}
            role="img"
            aria-label="at decision time, then now"
          >
            <title>Tier and score at decision time, then now</title>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <TierBadge tier={newTierName} score={drift.newScore ?? null} />
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: "2px 8px",
            borderRadius: "var(--radius-chip)",
            color: reason.fg,
            background: reason.bg,
          }}
        >
          {reason.label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            marginLeft: "auto",
          }}
        >
          {relativeTime(drift.detectedAt)}
        </span>
        {resolved && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: "var(--radius-chip)",
              background: "rgba(79,209,154,.14)",
              color: "#7fe0b5",
            }}
          >
            {resolutionLabel(drift.resolution)}
          </span>
        )}
      </div>

      {!resolved && divergence && (
        <div
          style={{
            borderLeft: `2px solid ${reason.border}`,
            padding: "2px 0 2px 12px",
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  marginBottom: 2,
                }}
              >
                We passed because
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
                  fontStyle: "italic",
                  overflowWrap: "anywhere",
                }}
              >
                {rejectionReason && rejectionReason.trim() !== ""
                  ? `“${rejectionReason.trim()}”`
                  : "no rationale on file"}
              </div>
            </div>
            <div
              aria-hidden="true"
              style={{
                alignSelf: "center",
                color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              →
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  marginBottom: 2,
                }}
              >
                Market observed
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: DIVERGENCE_FG,
                  overflowWrap: "anywhere",
                }}
              >
                {outcomeLabel(observedOutcome ?? null)}
              </div>
            </div>
          </div>
        </div>
      )}

      {!resolved && !divergence && firstChange && (
        <div
          style={{
            borderLeft: "2px solid var(--color-divider)",
            padding: "2px 0 2px 12px",
            marginTop: 12,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
              fontStyle: "italic",
              overflowWrap: "anywhere",
            }}
          >
            {firstChange.axis ?? "unknown axis"}: {formatChangeValue(firstChange.old)} →{" "}
            {formatChangeValue(firstChange.new)}
          </div>
          {(firstChange.source || firstChange.dated) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
                fontSize: 10,
                color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
              }}
            >
              {firstChange.source && <span>{firstChange.source}</span>}
              {firstChange.dated && (
                <span>· {relativeTime(firstChange.dated) || firstChange.dated}</span>
              )}
            </div>
          )}
          {changed.length > 1 && (
            <div
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                marginTop: 4,
              }}
            >
              +{changed.length - 1} more axis change{changed.length > 2 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {!resolved && lookalikes.total > 0 && (
        <>
          <button
            type="button"
            onClick={() => setLookalikesOpen((v) => !v)}
            aria-expanded={lookalikesOpen}
            style={{
              marginTop: 12,
              background: "none",
              border: 0,
              cursor: "pointer",
              color: "var(--color-accent)",
              font: "inherit",
              fontSize: 12,
              padding: 0,
              textAlign: "left",
            }}
            title="Other passed firms whose rejection reason cites the axis that invalidated this firm's reason"
          >
            {lookalikesOpen
              ? "Hide"
              : `+${lookalikes.total} passed firm${lookalikes.total === 1 ? "" : "s"} share this now-stale reason`}
          </button>
          {lookalikesOpen && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 8,
              }}
            >
              {lookalikes.firms.map((l) => (
                <span key={l.firmId} className="tag tag-neutral" title={l.firmId}>
                  {l.firmName}
                </span>
              ))}
              {lookalikes.total > lookalikes.firms.length && (
                <span
                  style={{
                    fontSize: 12,
                    alignSelf: "center",
                    color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                  }}
                >
                  and {lookalikes.total - lookalikes.firms.length} more
                </span>
              )}
            </div>
          )}
        </>
      )}

      {!resolved && kind !== null && (
        <>
          {failures.length > 0 && (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                background: "rgba(240,113,103,.12)",
                color: "#f4948b",
                fontSize: 12,
              }}
            >
              {failures.map((m) => (
                <div key={m}>{m}</div>
              ))}
            </div>
          )}

          {notePanel === null ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {kind === "passed" ? (
                <>
                  <button className="btn btn-primary" disabled={busy} onClick={onReEngage}>
                    {reEngage.isPending ? "Re-engaging…" : "Re-engage"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => setNotePanel("keepPassed")}
                  >
                    Keep passed…
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" disabled={busy} onClick={onAcknowledge}>
                    {acknowledge.isPending ? "Keeping…" : "Keep in pipeline"}
                  </button>
                  {canPass && (
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => setNotePanel("pass")}
                    >
                      Pass…
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                }}
              >
                {notePanel === "keepPassed"
                  ? "A rationale is required to keep this firm passed."
                  : "A rationale is required to pass on this firm."}
              </div>
              <textarea
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  notePanel === "keepPassed"
                    ? "Why keep this firm passed despite the drift?"
                    : "Why pass on this firm after the drift?"
                }
                style={{ minHeight: 72, lineHeight: 1.45 }}
                aria-label={
                  notePanel === "keepPassed"
                    ? "Reason to keep this firm passed"
                    : "Reason to pass on this firm"
                }
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={!canSubmitNote}
                  onClick={notePanel === "keepPassed" ? onKeepPassed : onPass}
                >
                  {notePanel === "keepPassed"
                    ? keepPassed.isPending
                      ? "Keeping…"
                      : "Keep passed"
                    : pass.isPending
                      ? "Passing…"
                      : "Pass firm"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={closeNotePanel}
                  disabled={noteSubmitting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined) {
    return "—";
  }
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return "?";
  }
}

// ─── Root ───────────────────────────────────────────────────────────────

function Review(): React.ReactElement {
  const {
    data: driftData,
    isLoading: driftLoading,
    error: driftError,
  } = useOsdkObjects(DriftEvent, {
    orderBy: { detectedAt: "desc" },
    autoFetchMore: true,
  });
  const { data: firmsData } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, {
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });

  const firmById = React.useMemo(() => {
    const m = new Map<string, unknown>();
    for (const f of firmsData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, f);
      }
    }
    return m;
  }, [firmsData]);

  const firmNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firmsData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, f.firmName ?? f.firmId);
      }
    }
    return m;
  }, [firmsData]);

  // Observed post-decision outcome per firm. FDE backfills Firm.outcome
  // after a market event (LOI, went cold, acquired by competitor, …);
  // outcome_diverged drift events want the human label rendered next to
  // the analyst's original rejection reason.
  const outcomeByFirm = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of (firmsData ?? []) as unknown as FirmLike[]) {
      if (f.firmId === undefined || f.firmId === "") {
        continue;
      }
      const raw = (f.outcome ?? "").trim();
      if (raw !== "") {
        m.set(f.firmId, raw);
      }
    }
    return m;
  }, [firmsData]);

  const drifts = React.useMemo(() => (driftData ?? []) as unknown as DriftLike[], [driftData]);

  // Why each firm was passed: its newest reject decision (the query is
  // ordered newest first). Later keep_passed / acknowledge_drift decisions
  // are about the drift, not the original pass, so they never count.
  const rejectionByFirm = React.useMemo(
    () => latestRejection(decisionsData ?? []),
    [decisionsData],
  );

  // "We passed because …" on outcome_diverged drift cards.
  const rejectionReasonByFirm = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const [fid, d] of rejectionByFirm) {
      const text = reasonText(d);
      if (text !== "") {
        m.set(fid, text);
      }
    }
    return m;
  }, [rejectionByFirm]);

  const passedFirms = React.useMemo(
    () =>
      ((firmsData ?? []) as unknown as FirmLike[]).filter(
        (f) => !!f.firmId && normalizeLifecycle(f.lifecycleState) === PASSED,
      ),
    [firmsData],
  );

  // Lookalikes only make sense when a passed firm's reason has been
  // invalidated: other passed firms whose reason cites the same axis may be
  // stale too. Computed once per drift so cards don't redo it per render.
  const lookalikesByDrift = React.useMemo(() => {
    const m = new Map<string, LookalikeSet>();
    for (const d of drifts) {
      if (
        (d.driftStatus ?? "").toLowerCase() === "resolved" ||
        d.driftReason !== "pass_reason_invalidated"
      ) {
        continue;
      }
      const { firms, total } = lookalikesFor(d, passedFirms, rejectionByFirm);
      if (total > 0) {
        m.set(d.driftEventId, {
          total,
          firms: firms.map((f) => ({
            firmId: f.firmId ?? "",
            firmName: f.firmName ?? f.firmId ?? "",
          })),
        });
      }
    }
    return m;
  }, [drifts, passedFirms, rejectionByFirm]);

  // Open first, resolved after — within each, most-recent detectedAt first
  // (query already returns desc so the input order is fine).
  const ordered = React.useMemo(() => {
    const open: DriftLike[] = [];
    const resolved: DriftLike[] = [];
    for (const d of drifts) {
      if ((d.driftStatus ?? "").toLowerCase() === "resolved") {
        resolved.push(d);
      } else {
        open.push(d);
      }
    }
    return { open, resolved };
  }, [drifts]);

  const total = ordered.open.length;

  return (
    <div
      className="dsn"
      style={{
        position: "fixed",
        inset: 0,
        background: VOID_BG,
        display: "flex",
      }}
    >
      <aside style={SIDEBAR_STYLE}>
        <BrandMark section="Review" />
        <WorkspaceNavLinks />
        <DemoFooter />
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 24px",
            borderBottom: "1px solid var(--color-divider)",
            height: 56,
            flex: "0 0 56px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontWeight: 500, fontSize: 16 }}>
              <Term id="Drift">Drift</Term> queue
            </span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {driftLoading && drifts.length === 0
                ? "Loading drift events…"
                : `${total} firm${total === 1 ? "" : "s"} ha${total === 1 ? "s" : "ve"} moved since qualification${
                    ordered.resolved.length > 0 ? ` · ${ordered.resolved.length} resolved` : ""
                  }`}
            </span>
          </div>
        </header>

        {driftError && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(240,113,103,.12)",
              color: "#f4948b",
              fontSize: 12,
            }}
          >
            {String(driftError)}
          </div>
        )}

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {!driftLoading && drifts.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                textAlign: "center",
                minHeight: 400,
              }}
            >
              <span
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: "var(--radius-lg)",
                  background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--color-accent)",
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div style={{ fontSize: 19, fontWeight: 600 }}>
                No firms have moved since qualification
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  maxWidth: "44ch",
                }}
              >
                Beacon watches for score-changing updates on firms you&rsquo;ve already passed. When
                a stale reason is invalidated, it surfaces here.
              </p>
            </div>
          )}

          {ordered.open.map((d, i) => (
            <DriftCard
              key={d.driftEventId}
              explainTier={i === 0}
              drift={d}
              firmName={firmNameById.get(d.firmId ?? "") ?? d.firmId ?? "Unknown firm"}
              firmObj={firmById.get(d.firmId ?? "")}
              lookalikes={lookalikesByDrift.get(d.driftEventId) ?? NO_LOOKALIKES}
              rejectionReason={rejectionReasonByFirm.get(d.firmId ?? "") ?? null}
              observedOutcome={outcomeByFirm.get(d.firmId ?? "") ?? null}
            />
          ))}

          {ordered.resolved.length > 0 && (
            <>
              <div style={{ marginTop: 16 }}>
                <Kicker>Resolved</Kicker>
              </div>
              {ordered.resolved.map((d) => (
                <DriftCard
                  key={d.driftEventId}
                  drift={d}
                  firmName={firmNameById.get(d.firmId ?? "") ?? d.firmId ?? "Unknown firm"}
                  firmObj={firmById.get(d.firmId ?? "")}
                  lookalikes={lookalikesByDrift.get(d.driftEventId) ?? NO_LOOKALIKES}
                />
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default Review;
