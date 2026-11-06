import React from "react";
import { useObservableClient, useOsdkAction } from "@/data/hooks";
import { advanceStageAction, qualifyFirmAction, rejectFirmAction } from "@/data/ontology";
import {
  PASSED,
  isQualifiedOrLater,
  nextLifecycle,
  normalizeLifecycle,
} from "../../../shared/vocab";
import { type MirrorResult } from "../scoreMirror";
import { REJECT_BORDER, REJECT_TEXT } from "../tokens";
import { Kicker } from "./chips";
import { type EditMap, type FirmView, formatActionError } from "./deskModel";
import { HARD_GATES } from "./hardGateConfig";

export function ConfirmChecklist({
  firm,
  mirror,
  edits,
}: {
  firm: FirmView;
  mirror: MirrorResult;
  edits: EditMap;
}): React.ReactElement {
  const knownAxes = mirror.axisScores.filter((a) => a.known).length;
  const totalAxes = mirror.axisScores.length;
  const gatesSet = HARD_GATES.filter((g) => {
    const editVal = edits[g.editKey];
    const onFile = firm[g.readKey];
    return typeof editVal === "boolean" || onFile === true || onFile === false;
  }).length;

  const items = [
    {
      label: "All rubric axes have a signal",
      detail: `${knownAxes}/${totalAxes} axes known`,
      ok: knownAxes === totalAxes,
    },
    {
      label: "Hard gates recorded",
      detail: `${gatesSet}/${HARD_GATES.length} gates answered`,
      ok: gatesSet === HARD_GATES.length,
    },
    {
      label: mirror.hardRejected ? "Hard screen (rejected)" : "Cleared the hard screen",
      detail: mirror.hardRejected ? mirror.rejectReason : "no rejection triggers",
      ok: !mirror.hardRejected,
    },
  ];
  const done = items.filter((i) => i.ok).length;
  const barPct = Math.round((done / items.length) * 100);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Kicker>Confirm before advancing</Kicker>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {done}/{items.length}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: "var(--radius-xs)",
          background: "var(--color-neutral-800)",
          marginBottom: 12,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${barPct}%`,
            background: "var(--color-accent)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
        {items.map((it) => (
          <label
            key={it.label}
            style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "default" }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                marginTop: 1,
                borderRadius: "var(--radius-sm)",
                border: `1.5px solid ${it.ok ? "var(--color-accent)" : "var(--color-divider)"}`,
                background: it.ok ? "var(--color-accent)" : "transparent",
                color: "var(--color-bg)",
                fontSize: 10,
                fontWeight: 700,
                flex: "none",
              }}
            >
              {it.ok ? "✓" : ""}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>{it.label}</span>
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                  display: "block",
                }}
              >
                {it.detail}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: 10,
  border: "1px solid var(--color-divider)",
  borderRadius: "var(--radius-sm)",
  padding: "1px 6px",
  fontFamily: "inherit",
};

export function YourCallRail({
  firm,
  actionFirm,
  onCommit,
  dirty,
  enrichPending,
  enrichError,
}: {
  firm: FirmView;
  actionFirm: unknown;
  onCommit: () => void;
  dirty: boolean;
  enrichPending: boolean;
  enrichError: unknown;
}): React.ReactElement {
  const qualify = useOsdkAction(qualifyFirmAction);
  const reject = useOsdkAction(rejectFirmAction);
  const advance = useOsdkAction(advanceStageAction);
  const observable = useObservableClient();
  const [note, setNote] = React.useState("");
  // The missing-note error waits for a Pass attempt; it isn't shown on first sight of the form.
  const [attemptedPass, setAttemptedPass] = React.useState(false);
  const firmKey = firm.firmId;
  React.useEffect(() => {
    setAttemptedPass(false);
  }, [firmKey]);

  // Function-backed actions report their created objects (the ReviewDecision)
  // but not reliably the firm they modified, so the automatic cache
  // invalidation refreshes the decision-memory banner while the firm header
  // keeps its stale lifecycle — and the rail then offers a transition the
  // server has already completed. Invalidate the firm explicitly after every
  // successful decision.
  const refreshFirm = React.useCallback((): void => {
    void observable.invalidateObjects(actionFirm as never);
  }, [observable, actionFirm]);

  // The stage comes from lifecycleState first, falling back to currentStage;
  // normalizeLifecycle maps legacy names onto the funnel. Terminal means the
  // firm was Passed (in either field) or has Closed.
  const stage = normalizeLifecycle(firm.lifecycleState ?? firm.currentStage);
  const passed = [firm.lifecycleState, firm.currentStage].some(
    (raw) => normalizeLifecycle(raw) === PASSED,
  );
  const terminalKind: "closed" | "passed" | null = passed
    ? "passed"
    : stage === "Closed"
      ? "closed"
      : null;
  const stageLabel: string = passed ? PASSED : stage;
  // Advance moves a qualified firm one stage down the deal funnel. Before
  // Qualified the move is the Qualify decision, not Advance.
  const qualified = !passed && isQualifiedOrLater(stage);
  const nextState = qualified ? nextLifecycle(stage) : null;

  const onQualify = (): void => {
    void qualify.applyAction({ firm: actionFirm } as never).then(refreshFirm);
  };
  const onAdvance = (): void => {
    if (nextState === null) {
      return;
    }
    void advance
      .applyAction({ firm: actionFirm, targetState: nextState } as never)
      .then(refreshFirm);
  };
  const onReject = (): void => {
    if (note.trim().length === 0) {
      setAttemptedPass(true);
      return;
    }
    // Note preserved if reject fails (only cleared on success).
    void reject
      .applyAction({ firm: actionFirm, rejectionRationale: note.trim() } as never)
      .then(() => {
        setNote("");
        setAttemptedPass(false);
        refreshFirm();
      });
  };

  const noteMissing = attemptedPass && note.trim() === "";
  const anyError =
    enrichError !== undefined ||
    qualify.error !== undefined ||
    reject.error !== undefined ||
    advance.error !== undefined;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-divider)",
        background: "color-mix(in srgb, var(--color-neutral-900) 55%, transparent)",
        padding: "12px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {anyError && (
        <div
          style={{
            padding: 12,
            borderRadius: "var(--radius-md)",
            background: "rgba(240,113,103,.12)",
            border: "1px solid color-mix(in srgb, #f07167 40%, transparent)",
            fontSize: 12,
            color: "#f4948b",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 9v4M12 17h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            Couldn&rsquo;t save your decision. Your note is preserved below.
          </div>
          {enrichError !== undefined && (
            <div style={{ marginTop: 4 }}>Commit: {formatActionError(enrichError)}</div>
          )}
          {qualify.error !== undefined && (
            <div style={{ marginTop: 4 }}>Qualify: {formatActionError(qualify.error)}</div>
          )}
          {advance.error !== undefined && (
            <div style={{ marginTop: 4 }}>Advance: {formatActionError(advance.error)}</div>
          )}
          {reject.error !== undefined && (
            <div style={{ marginTop: 4 }}>Pass: {formatActionError(reject.error)}</div>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240 }}>
          <Kicker>Your call</Kicker>
          <button
            className="btn btn-primary btn-block"
            style={{
              justifyContent: "space-between",
              background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
            }}
            disabled={!dirty || enrichPending}
            onClick={onCommit}
            title="Save verified state without moving the firm"
          >
            <span>{enrichPending ? "Saving…" : "Commit enrichment"}</span>
            <kbd
              style={{
                fontSize: 10,
                border: "1px solid var(--color-accent)",
                borderRadius: "var(--radius-sm)",
                padding: "1px 5px",
                opacity: 0.85,
              }}
            >
              ⌘↵
            </kbd>
          </button>
          {terminalKind === null ? (
            <>
              {qualified && (
                <button
                  className="btn btn-primary btn-block"
                  style={{ justifyContent: "space-between", marginTop: 0 }}
                  disabled={advance.isPending || nextState === null}
                  onClick={onAdvance}
                  // Canonical explanation first, then the specific target the
                  // analyst is about to move this firm to.
                  title={
                    nextState === null
                      ? `${stageLabel} is the final stage. No further advance available.`
                      : `Move one stage down the pipeline: ${stageLabel} to ${nextState}`
                  }
                >
                  <span>
                    {advance.isPending
                      ? "Advancing…"
                      : nextState !== null
                        ? `Advance → ${nextState}`
                        : `${stageLabel} · no next stage`}
                  </span>
                  <kbd
                    style={{
                      fontSize: 10,
                      border: "1px solid var(--color-accent)",
                      borderRadius: "var(--radius-sm)",
                      padding: "1px 5px",
                      opacity: nextState === null ? 0.4 : 0.85,
                    }}
                  >
                    2
                  </kbd>
                </button>
              )}
              {!qualified && (
                <button
                  className="btn btn-secondary btn-block"
                  style={{ marginTop: 0, justifyContent: "space-between" }}
                  disabled={qualify.isPending}
                  onClick={onQualify}
                  title="Accept into the funnel"
                >
                  <span>{qualify.isPending ? "Qualifying…" : "Qualify firm"}</span>
                  <kbd
                    style={{
                      fontSize: 10,
                      border: "1px solid var(--color-divider)",
                      borderRadius: "var(--radius-sm)",
                      padding: "1px 5px",
                      opacity: 0.7,
                    }}
                  >
                    Q
                  </kbd>
                </button>
              )}
              <button
                className="btn btn-secondary btn-block"
                style={{
                  marginTop: 0,
                  justifyContent: "space-between",
                  color: REJECT_TEXT,
                  borderColor: REJECT_BORDER,
                }}
                disabled={reject.isPending}
                onClick={onReject}
                title="Pass on this firm. A decision note is required."
              >
                <span>{reject.isPending ? "Passing…" : "Pass…"}</span>
                <kbd
                  style={{
                    fontSize: 10,
                    border: `1px solid ${REJECT_BORDER}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 5px",
                    opacity: 0.85,
                  }}
                >
                  R
                </kbd>
              </button>
            </>
          ) : (
            <div
              style={{
                marginTop: 2,
                padding: 12,
                borderRadius: "var(--radius-md)",
                border: "1px dashed var(--color-divider)",
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              }}
              title="Advance, Qualify, and Pass are unavailable once a firm is Passed or Closed."
            >
              Terminal state · {terminalKind === "closed" ? "Closed" : PASSED}
            </div>
          )}
        </div>

        {/* Decision note */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Kicker>Decision note</Kicker>
          <textarea
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteMissing}
            aria-describedby={noteMissing ? "decision-note-error" : undefined}
            placeholder={
              terminalKind === null
                ? "Optional for advance/qualify · required to pass…"
                : "Firm is in a terminal state. Notes here won't be attached to a decision."
            }
            style={{ minHeight: 104, lineHeight: 1.45 }}
          />
          <div
            id={noteMissing ? "decision-note-error" : undefined}
            role={noteMissing ? "alert" : undefined}
            style={{
              fontSize: 11,
              color:
                terminalKind !== null
                  ? "color-mix(in srgb, var(--color-text) 45%, transparent)"
                  : noteMissing
                    ? "#f4948b"
                    : "color-mix(in srgb, var(--color-text) 45%, transparent)",
            }}
          >
            {terminalKind !== null
              ? "No decision actions available in a terminal state."
              : noteMissing
                ? "A note is required to pass."
                : note.trim() === ""
                  ? "Add a note to pass on this firm."
                  : "Note captured as the pass rationale."}
          </div>
        </div>

        {/* Shortcuts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          <Kicker>Shortcuts</Kicker>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 10px",
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
            }}
          >
            <span style={{ display: "flex", gap: 4 }}>
              <kbd style={kbdStyle}>↑</kbd>
              <kbd style={kbdStyle}>↓</kbd>
            </span>
            <span>Focus axis / gate</span>
            <span style={{ display: "flex", gap: 4 }}>
              <kbd style={kbdStyle}>0</kbd>
              <kbd style={kbdStyle}>1</kbd>
              <kbd style={kbdStyle}>2</kbd>
            </span>
            <span>Set band on focused axis</span>
            <span style={{ display: "flex", gap: 4 }}>
              <kbd style={kbdStyle}>P</kbd>
              <kbd style={kbdStyle}>F</kbd>
            </span>
            <span>Pass / Fail focused hard gate</span>
            <span>
              <kbd style={kbdStyle}>⌘/Ctrl</kbd>+<kbd style={kbdStyle}>↵</kbd>
            </span>
            <span>Commit enrichment</span>
          </div>
        </div>
      </div>
    </div>
  );
}
