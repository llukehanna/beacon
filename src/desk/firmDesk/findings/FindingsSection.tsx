import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { ResearchFinding } from "@/data/ontology";
import { type AxisGroup, type FindingLike, classifyAxis, pickAuthoritative } from "../../axisState";
import { effectiveAxisValue } from "../../findingActions";
import { Kicker, SectionHeader } from "../chips";
import { type EditMap, type FirmView, displayAxis } from "../deskModel";
import { AbstainFindingCard } from "./AbstainFindingCard";
import { AxisCard } from "./AxisCard";
import { ConflictFindingCard } from "./ConflictFindingCard";

export function FindingsSection({
  firm,
  edits,
  onApply,
  applyEdit,
  pendingVerify,
  queueVerify,
}: {
  firm: FirmView;
  edits: EditMap;
  // Legacy raw-string apply — still used by AbstainFindingCard (analyst-
  // typed) and ConflictFindingCard (winner-of-two-sources), where the
  // value is already the analyst's chosen answer and no conflict UI is
  // needed. Both feed through setAxis in the parent.
  onApply: (axis: string, value: string) => void;
  // Typed apply used by AxisCard after decideAccept/decideVerify. Values
  // are already coerced to the shape enrichFirmAction expects.
  applyEdit: (editKey: string, value: string | number | boolean) => void;
  // Verifications stage locally and flush on Commit enrichment — the panel
  // owns the queue so it resets alongside the edit map.
  pendingVerify: Record<string, string | true>;
  queueVerify: (f: FindingLike, overrideValue?: string) => void;
}): React.ReactElement {
  const firmId = firm.firmId ?? "";
  const { data, isLoading, error } = useOsdkObjects(ResearchFinding, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
  });
  // resolveConflictAction now lives inside ConflictFindingCard so per-card
  // errors surface next to the buttons that triggered them.

  // Staged verifications render as verified ahead of the commit that will
  // persist them — same overlay the panel applies for the axis chips.
  const findings = React.useMemo(() => {
    const raw = (data ?? []) as unknown as FindingLike[];
    return raw.map((f) =>
      f.findingId !== undefined && f.findingId !== "" && pendingVerify[f.findingId] !== undefined
        ? { ...f, findingStatus: "verified", verifiedByHuman: true }
        : f,
    );
  }, [data, pendingVerify]);

  // Server-side dedupe now marks prior same-(firm, axis, provider) findings
  // superseded on every agent run and never touches human-verified ones —
  // so the visible set is simply everything that isn't marked superseded.
  // From there we group by axis and pick one authoritative finding per axis.
  const groups = React.useMemo(() => {
    const visible = findings.filter((f) => (f.findingStatus ?? "").toLowerCase() !== "superseded");

    const conflictMap = new Map<string, FindingLike[]>();
    const nonConflict: FindingLike[] = [];
    for (const f of visible) {
      const gid = f.conflictGroupId;
      if (gid !== null && gid !== undefined && gid !== "") {
        const arr = conflictMap.get(gid) ?? [];
        arr.push(f);
        conflictMap.set(gid, arr);
      } else {
        nonConflict.push(f);
      }
    }

    const byAxis = new Map<string, FindingLike[]>();
    for (const f of nonConflict) {
      const ax = f.axis ?? "";
      const arr = byAxis.get(ax) ?? [];
      arr.push(f);
      byAxis.set(ax, arr);
    }

    const proposed: AxisGroup[] = [];
    const abstained: AxisGroup[] = [];
    const verified: AxisGroup[] = [];
    for (const [axis, arr] of byAxis) {
      const authoritative = pickAuthoritative(arr);
      const history = arr.filter((x) => x.findingId !== authoritative.findingId);
      const group: AxisGroup = {
        axis,
        authoritative,
        history,
        state: classifyAxis(authoritative),
      };
      if (group.state === "proposed") {
        proposed.push(group);
      } else if (group.state === "abstained") {
        abstained.push(group);
      } else {
        verified.push(group);
      }
    }
    // Stable, human-friendly order inside each group: by axis label.
    const byLabel = (a: AxisGroup, b: AxisGroup): number =>
      displayAxis(a.axis).localeCompare(displayAxis(b.axis));
    proposed.sort(byLabel);
    abstained.sort(byLabel);
    verified.sort(byLabel);

    return { conflicts: [...conflictMap.values()], proposed, abstained, verified };
  }, [findings]);

  const [abstainOpen, setAbstainOpen] = React.useState(false);
  const [verifiedOpen, setVerifiedOpen] = React.useState(false);
  const isEmpty =
    groups.conflicts.length === 0 &&
    groups.proposed.length === 0 &&
    groups.abstained.length === 0 &&
    groups.verified.length === 0;

  const getCurrent = React.useCallback(
    (editKey: string) =>
      effectiveAxisValue(firm as unknown as Record<string, unknown>, edits, editKey),
    [firm, edits],
  );

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
        <Kicker>Findings</Kicker>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {isLoading
              ? "loading…"
              : `${groups.conflicts.length} conflict${groups.conflicts.length === 1 ? "" : "s"} · ${groups.proposed.length} proposed · ${groups.abstained.length} abstained · ${groups.verified.length} verified · axes`}
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 8,
            borderRadius: "var(--radius-md)",
            background: "rgba(240,113,103,.12)",
            color: "#f4948b",
            fontSize: 12,
          }}
        >
          {String(error)}
        </div>
      )}

      {!isLoading && isEmpty ? (
        <div
          style={{
            padding: "40px 20px",
            border: "1px dashed var(--color-divider)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            textAlign: "center",
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-lg)",
              background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              display: "grid",
              placeItems: "center",
              color: "var(--color-accent)",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 2v6M12 22v-6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M2 12h6M22 12h-6" />
            </svg>
          </span>
          <div style={{ fontSize: 16, fontWeight: 500 }}>No enrichment run yet</div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
              maxWidth: "40ch",
            }}
          >
            Beacon hasn&rsquo;t scored this firm against the rubric. Run the agent from the strip
            above to pull findings from every source.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.conflicts.length > 0 && (
            <div>
              <SectionHeader
                label={groups.conflicts.length === 1 ? "Conflict" : "Conflicts"}
                count={groups.conflicts.length}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {groups.conflicts.map((pair, i) => (
                  <ConflictFindingCard key={`conflict-${i}`} findings={pair} onApply={onApply} />
                ))}
              </div>
            </div>
          )}

          {groups.proposed.length > 0 && (
            <div>
              <SectionHeader label="Proposed" count={groups.proposed.length} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {groups.proposed.map((g) => (
                  <AxisCard
                    key={`prop-${g.axis}`}
                    group={g}
                    getCurrent={getCurrent}
                    applyEdit={applyEdit}
                    verifyFinding={queueVerify}
                    verifying={false}
                  />
                ))}
              </div>
            </div>
          )}

          {groups.abstained.length > 0 && (
            <div
              style={{
                border: "1px solid color-mix(in srgb, #f07167 30%, transparent)",
                borderRadius: "var(--radius-md)",
                background: "rgba(240,113,103,.06)",
              }}
            >
              <button
                type="button"
                onClick={() => setAbstainOpen((v) => !v)}
                aria-expanded={abstainOpen}
                style={{
                  width: "100%",
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "var(--radius-chip)",
                    background: "rgba(240,113,103,.24)",
                    color: "#f7aaa3",
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {groups.abstained.length}
                </span>
                <span style={{ fontSize: 13, color: "#f4948b", fontWeight: 500 }}>
                  {groups.abstained.length === 1 ? "1 axis" : `${groups.abstained.length} axes`} had
                  no source, needs you
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                  }}
                >
                  {abstainOpen ? "collapse ▲" : "expand ▼"}
                </span>
              </button>
              {abstainOpen && (
                <div
                  style={{
                    padding: "0 12px 12px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  {groups.abstained.map((g) => (
                    <AbstainFindingCard
                      key={g.authoritative.findingId}
                      finding={g.authoritative}
                      firmModel={(firm.firmType ?? "").trim().toLowerCase() === "cs" ? "CS" : "CF"}
                      applyEdit={applyEdit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {groups.verified.length > 0 && (
            <div
              style={{
                border: "1px solid var(--color-divider)",
                borderRadius: "var(--radius-md)",
                background: "color-mix(in srgb, var(--color-neutral-900) 40%, transparent)",
              }}
            >
              <button
                type="button"
                onClick={() => setVerifiedOpen((v) => !v)}
                aria-expanded={verifiedOpen}
                style={{
                  width: "100%",
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "var(--radius-chip)",
                    background: "rgba(79,209,154,.20)",
                    color: "#8ee5c0",
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {groups.verified.length}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  Verified ·{" "}
                  {groups.verified.length === 1 ? "1 axis" : `${groups.verified.length} axes`}{" "}
                  confirmed
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
                  }}
                >
                  {verifiedOpen ? "collapse ▲" : "expand ▼"}
                </span>
              </button>
              {verifiedOpen && (
                <div
                  style={{
                    padding: "0 12px 12px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  {groups.verified.map((g) => (
                    <AxisCard
                      key={`ver-${g.axis}`}
                      group={g}
                      getCurrent={getCurrent}
                      applyEdit={applyEdit}
                      verifyFinding={queueVerify}
                      verifying={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
