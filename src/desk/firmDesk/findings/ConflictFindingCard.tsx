import React from "react";
import { ViewSourceButton } from "@/components/SourceDrawer";
import { useOsdkAction } from "@/data/hooks";
import { resolveConflictAction } from "@/data/ontology";
import { type FindingLike } from "../../axisState";
import { displayFindingValue } from "../../findingActions";
import { providerLabel } from "../../tokens";
import { ModelChip } from "../chips";
import { displayAxis, findingCardShell } from "../deskModel";

export function ConflictFindingCard({
  findings,
  onApply,
}: {
  findings: FindingLike[];
  onApply: (axis: string, value: string) => void;
}): React.ReactElement {
  const resolve = useOsdkAction(resolveConflictAction);
  const axisRaw = findings[0]?.axis ?? "unknown";
  const axis = displayAxis(axisRaw);
  const [a, b] = findings;
  const [threwError, setThrewError] = React.useState<string | null>(null);

  const pick = async (chosen: FindingLike, rejected: FindingLike): Promise<void> => {
    setThrewError(null);
    try {
      // Both `chosen` and `rejected` here are the raw WireObject rows from
      // the ResearchFinding query (FindingLike is a shape-only cast). The
      // action needs the objects themselves so the ontology can traverse
      // and mutate them — never IDs.
      await resolve.applyAction({
        chosenFinding: chosen,
        rejectedFinding: rejected,
        chosenValue: chosen.value ?? "",
      } as never);
      // Only after the ontology confirms the resolve, mirror the choice
      // into the local edit map so the axis breakdown reflects it.
      onApply(chosen.axis ?? "", chosen.value ?? "");
    } catch (e) {
      setThrewError(String(e));
    }
  };

  const errorText = resolve.error !== undefined ? String(resolve.error) : threwError;

  return (
    <div style={findingCardShell("1px solid color-mix(in srgb, #f0b955 40%, transparent)")}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
      >
        <span
          style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 52%, transparent)" }}
        >
          {axis}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: "var(--radius-chip)",
            color: "#f3c978",
            background: "rgba(240,185,85,.20)",
          }}
        >
          Conflict
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {[a, b].filter(Boolean).map((f, i) => {
          const other = i === 0 ? b : a;
          const disabled = resolve.isPending || !other;
          return (
            <div key={f.findingId} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <button
                type="button"
                onClick={() => {
                  if (other) {
                    void pick(f, other);
                  }
                }}
                disabled={disabled}
                style={{
                  flex: 1,
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-chip)",
                  padding: 8,
                  background: "none",
                  color: "inherit",
                  cursor: disabled ? "default" : "pointer",
                  textAlign: "left",
                  font: "inherit",
                }}
                title={`Accept ${f.provider ? providerLabel(f.provider) : "this source"} and mark the other as rejected`}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                  }}
                >
                  {f.provider ? providerLabel(f.provider) : "—"}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#f3c978",
                    overflowWrap: "anywhere",
                  }}
                >
                  {/* Route through the shared vocab so gate conflicts read
                    Pass / Fail (matching the gates row + conflict prompt)
                    instead of leaking raw "true" / "false" strings. */}
                  {displayFindingValue(f.axis, f.value)}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-accent)",
                    marginTop: 4,
                  }}
                >
                  {resolve.isPending
                    ? "Resolving…"
                    : `Accept ${f.provider ? providerLabel(f.provider) : ""} →`}
                </div>
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <ViewSourceButton finding={f} />
                <ModelChip model={f.extractionModel} />
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
          marginTop: 4,
        }}
      >
        Pick the source you trust. Resolves to verified.
      </div>
      {errorText !== null && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: "var(--radius-md)",
            background: "rgba(240,113,103,.12)",
            color: "#f4948b",
            fontSize: 11,
          }}
        >
          Resolve failed: {errorText}
        </div>
      )}
    </div>
  );
}
