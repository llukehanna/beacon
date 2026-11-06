import React from "react";
import { ViewSourceButton } from "@/components/SourceDrawer";
import { type AxisGroup, type FindingLike } from "../../axisState";
import {
  type AcceptDecision,
  FINDING_AXIS_TO_KEY,
  decideAccept,
  decideVerify,
  displayFindingValue,
  formatAxisValue,
} from "../../findingActions";
import { excerptText } from "../../sourceHighlight";
import { providerLabel } from "../../tokens";
import { ConfidenceChip, FindingStatusChip, ModelChip, ProviderChip } from "../chips";
import {
  displayAxis,
  findingCardShell,
  formatRetrievedShort,
  stringifyOverride,
} from "../deskModel";

// Per-axis card. Renders the authoritative finding prominently, folds any
// older/lower-priority findings for the same axis into a collapsed
// disclosure. Used for both Proposed and Verified sections; buttons vary.
// Owns the Accept/Verify decision so the conflict prompt renders inline
// next to the finding (never a silent no-op).
export function AxisCard({
  group,
  getCurrent,
  applyEdit,
  verifyFinding,
  verifying,
}: {
  group: AxisGroup;
  getCurrent: (editKey: string) => string | number | boolean | null | undefined;
  applyEdit: (editKey: string, value: string | number | boolean) => void;
  verifyFinding: (f: FindingLike, overrideValue?: string) => void;
  verifying: boolean;
}): React.ReactElement {
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState<{
    mine: string | number | boolean;
    theirs: string | number | boolean;
    editKey: string;
    // Track whether the analyst opened the prompt via Accept or Verify
    // so "Take agent's" can also flip the finding to verified on the
    // Verify path.
    alsoVerify: boolean;
  } | null>(null);
  const [unroutable, setUnroutable] = React.useState<string | null>(null);
  const f = group.authoritative;
  const verified = group.state === "verified";

  const handleDecision = (
    decision: AcceptDecision,
    finding: FindingLike,
    alsoVerify: boolean,
  ): void => {
    if (decision.kind === "unroutable") {
      setConflict(null);
      setUnroutable(
        decision.reason === "unknown-axis"
          ? "This finding's axis doesn't map to a firm field yet."
          : "Finding value can't be routed to this field. Enter it manually.",
      );
      return;
    }
    setUnroutable(null);
    if (decision.kind === "apply") {
      applyEdit(decision.editKey, decision.value);
      if (alsoVerify) {
        verifyFinding(finding);
      } else {
        // Accept also marks the finding verified so the card leaves the
        // Proposed pile — matches the "marks the finding accepted" spec.
        verifyFinding(finding);
      }
      setConflict(null);
      return;
    }
    // conflict → surface the inline choice, don't silently no-op.
    setConflict({
      mine: decision.mine,
      theirs: decision.theirs,
      editKey: decision.editKey,
      alsoVerify,
    });
  };

  const onAcceptClick = (): void => {
    const rawAxis = (f.axis ?? "").trim().toLowerCase();
    const editKey = FINDING_AXIS_TO_KEY[rawAxis];
    const current = editKey !== undefined ? getCurrent(editKey) : undefined;
    handleDecision(decideAccept(f, current), f, false);
  };

  const onVerifyClick = (): void => {
    const rawAxis = (f.axis ?? "").trim().toLowerCase();
    const editKey = FINDING_AXIS_TO_KEY[rawAxis];
    const current = editKey !== undefined ? getCurrent(editKey) : undefined;
    handleDecision(decideVerify(f, current), f, true);
  };

  const onKeepMine = (): void => {
    if (conflict === null) {
      return;
    }
    // Preserve the analyst's value; record the override on the finding so
    // the accuracy layer sees an explicit disagreement rather than an
    // orphan proposal.
    verifyFinding(f, stringifyOverride(conflict.editKey, conflict.mine));
    setConflict(null);
  };

  const onTakeAgents = (): void => {
    if (conflict === null) {
      return;
    }
    applyEdit(conflict.editKey, conflict.theirs);
    verifyFinding(f);
    setConflict(null);
  };

  return (
    <div data-testid="finding-card" style={findingCardShell("none")}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
      >
        <span
          style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 52%, transparent)" }}
        >
          {displayAxis(group.axis)}
        </span>
        <FindingStatusChip status={verified ? "verified" : f.findingStatus} />
      </div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 600,
          marginTop: 4,
          overflowWrap: "anywhere",
          lineHeight: 1.25,
        }}
      >
        {displayFindingValue(group.axis, f.value)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <ProviderChip provider={f.provider} />
        <ConfidenceChip tier={f.confidenceTier} />
        <ModelChip model={f.extractionModel} />
      </div>
      {f.sourceExcerpt && (
        <div
          style={{
            fontSize: 11,
            color: "#f5d58f",
            marginTop: 4,
            overflowWrap: "anywhere",
          }}
        >
          {excerptText(f)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {verified ? (
          <ViewSourceButton finding={f} />
        ) : (
          <>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "3px 8px" }}
              disabled={verifying}
              onClick={onAcceptClick}
              title="Write the agent's proposed value to this axis and mark the finding accepted"
            >
              Accept →
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "3px 10px" }}
              disabled={verifying}
              onClick={onVerifyClick}
              title="Confirm the current value as human-checked"
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
            <ViewSourceButton finding={f} />
          </>
        )}
      </div>

      {conflict !== null && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: "var(--radius-md)",
            background: "rgba(240,185,85,.10)",
            border: "1px solid color-mix(in srgb, #f0b955 40%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: "#f3c978", lineHeight: 1.4 }}>
            You set <strong>{formatAxisValue(conflict.editKey, conflict.mine)}</strong>
            {" · "}
            agent proposes <strong>{formatAxisValue(conflict.editKey, conflict.theirs)}</strong>
            {" ("}
            {f.provider ? providerLabel(f.provider) : "unknown source"}
            {f.confidenceTier ? `, ${f.confidenceTier}` : ""}
            {")"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "3px 9px" }}
              disabled={verifying}
              onClick={onKeepMine}
            >
              Keep mine
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "3px 9px" }}
              disabled={verifying}
              onClick={onTakeAgents}
            >
              Take agent&rsquo;s
            </button>
          </div>
        </div>
      )}

      {unroutable !== null && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "#f4948b",
          }}
        >
          {unroutable}
        </div>
      )}

      {group.history.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              font: "inherit",
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              textAlign: "left",
            }}
            title="Prior findings for this axis from other providers or older runs"
          >
            {historyOpen
              ? `Hide history (${group.history.length})`
              : `history (${group.history.length}) ▾`}
          </button>
          {historyOpen && (
            <ul
              style={{
                listStyle: "none",
                margin: "6px 0 0",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {group.history.map((h) => {
                const dateLabel = formatRetrievedShort(h);
                return (
                  <li
                    key={h.findingId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: "color-mix(in srgb, var(--color-text) 68%, transparent)",
                    }}
                  >
                    <ProviderChip provider={h.provider} />
                    <span style={{ overflowWrap: "anywhere" }}>
                      {displayFindingValue(group.axis, h.value)}
                    </span>
                    {dateLabel && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {dateLabel}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
