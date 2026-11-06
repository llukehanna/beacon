import React from "react";
import { type FindingLike, axisBadge, classifyAxis, pickAuthoritative } from "../axisState";
import { type MirrorResult } from "../scoreMirror";
import { BandChip, ConfidenceChip, Kicker, ProviderChip } from "./chips";
import { type EditMap, type FirmView, editorForAxis, humanAxisValue } from "./deskModel";

export function AxisBreakdown({
  firm,
  mirror,
  edits,
  setAxis,
  focused,
  setFocused,
  findingsByAxisKey,
}: {
  firm: FirmView;
  mirror: MirrorResult;
  edits: EditMap;
  setAxis: (key: string, value: string | number | boolean) => void;
  focused: string | undefined;
  setFocused: (k: string | undefined) => void;
  findingsByAxisKey: Map<string, FindingLike[]>;
}): React.ReactElement {
  const model = mirror.model;
  const firmRecord = firm as unknown as Record<
    string,
    string | number | boolean | null | undefined
  >;

  return (
    <div
      style={{
        border: "1px solid var(--color-divider)",
        borderRadius: "var(--radius-md)",
        padding: 8,
        background: "color-mix(in srgb, var(--color-neutral-900) 45%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 10px 8px",
        }}
      >
        <Kicker>Axis breakdown · {mirror.axisScores.length} rubric axes</Kicker>
        <span
          style={{
            fontSize: 11,
            color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
          }}
        >
          Click a row to edit · score recomputes live
        </span>
      </div>
      {mirror.axisScores.map((axis) => {
        const ed = editorForAxis(axis.axis, model);
        const editing = ed !== undefined && focused === `axis:${axis.axis}`;
        const axisFindings = findingsByAxisKey.get(ed?.editKey ?? "");
        const finding =
          axisFindings !== undefined && axisFindings.length > 0
            ? pickAuthoritative(axisFindings)
            : undefined;
        const badge =
          finding !== undefined ? axisBadge(classifyAxis(finding), axis.known) : undefined;
        const bandInt = Number.isInteger(axis.score) ? (axis.score as 0 | 1 | 2) : null;
        const editValue = ed ? edits[ed.editKey] : undefined;
        const onFile = ed ? firmRecord[ed.editKey] : undefined;
        const canEdit = ed !== undefined;

        return (
          <div
            key={axis.axis}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onClick={() => {
              if (canEdit) {
                setFocused(`axis:${axis.axis}`);
              }
            }}
            onKeyDown={(e) => {
              if (canEdit && (e.key === "Enter" || e.key === " ")) {
                setFocused(`axis:${axis.axis}`);
                e.preventDefault();
              }
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "9px 10px",
              borderRadius: "var(--radius-chip)",
              cursor: canEdit ? "pointer" : "default",
              background: editing
                ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                : "transparent",
              boxShadow: editing
                ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent)"
                : "none",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {axis.axis}
              {editing && ed?.kind === "categorical" && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    color: "var(--color-accent)",
                    background: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
                    padding: "1px 6px",
                    borderRadius: "var(--radius-lg)",
                  }}
                >
                  0 1 2 · ESC
                </span>
              )}
            </span>
            <div style={{ minWidth: 0 }}>
              {!editing && (
                <>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: axis.known
                        ? "var(--color-text)"
                        : "color-mix(in srgb, var(--color-text) 45%, transparent)",
                    }}
                  >
                    {axis.known ? humanAxisValue(axis.axis, firm) : "—"}
                  </div>
                  {ed && editValue !== undefined && editValue !== "" && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-accent)",
                        marginTop: 1,
                      }}
                    >
                      pending: {String(editValue)}
                    </div>
                  )}
                  {!axis.known && !editValue && !(canEdit && badge?.label != null) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                        marginTop: 1,
                      }}
                    >
                      {canEdit ? "needs you" : "spine · not analyst-editable"}
                    </div>
                  )}
                </>
              )}
              {editing && ed?.kind === "categorical" && ed.options && (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    width: 180,
                    background: "var(--color-neutral-900)",
                    borderRadius: "var(--radius-chip)",
                    padding: 3,
                  }}
                >
                  {ed.options.map((o) => {
                    const chosen = editValue === o.label;
                    return (
                      <button
                        key={o.score}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAxis(ed.editKey, o.label);
                        }}
                        title={o.label}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          borderRadius: "var(--radius-chip)",
                          fontSize: 12,
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          border: "none",
                          cursor: "pointer",
                          background: chosen
                            ? "color-mix(in srgb, var(--color-accent) 20%, transparent)"
                            : "transparent",
                          color: chosen
                            ? "var(--color-accent)"
                            : "color-mix(in srgb, var(--color-text) 62%, transparent)",
                          boxShadow: chosen ? "inset 0 0 0 1px var(--color-accent)" : "none",
                        }}
                      >
                        {o.score}
                      </button>
                    );
                  })}
                </div>
              )}
              {editing && ed?.kind === "number" && (
                <input
                  ref={(el) => {
                    if (el !== null && document.activeElement !== el) {
                      el.focus();
                    }
                  }}
                  className="input"
                  type="number"
                  value={
                    typeof editValue === "number" || typeof editValue === "string"
                      ? String(editValue)
                      : ""
                  }
                  onChange={(e) => setAxis(ed.editKey, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={
                    onFile !== null && onFile !== undefined ? String(onFile) : (ed.unit ?? "")
                  }
                  style={{ width: 150, height: 32 }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifySelf: "end",
              }}
            >
              <BandChip band={bandInt} />
              {badge?.label != null && (
                <span style={{ fontSize: 11, fontWeight: 500, color: "#f4948b" }}>
                  {badge.label}
                </span>
              )}
              {finding !== undefined && badge?.showProvider === true && (
                <ProviderChip provider={finding.provider} />
              )}
              {finding !== undefined && badge?.showConfidence === true && (
                <ConfidenceChip tier={finding.confidenceTier} />
              )}
            </div>
          </div>
        );
      })}
      {mirror.hardRejected && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            background: "rgba(240,113,103,.14)",
            color: "#f4948b",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Hard-rejected: {mirror.rejectReason}
        </div>
      )}
    </div>
  );
}
