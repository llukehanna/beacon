import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { ReviewDecision } from "@/data/ontology";
import { type FirmView, describeCohort, truncateAtWord } from "./deskModel";

// ─── Decision memory banner ─────────────────────────────────────────────
// Aggregates ReviewDecisions across the current firm's COHORT (same firmType
// + employeeGroup, excluding the current firm) — surfaces the pattern so the
// analyst can spot repeat rejections. Never renders raw actor UUIDs.
export function DecisionMemory({
  firm,
  allFirms,
  firmsLoading,
  empty = null,
}: {
  firm: FirmView;
  allFirms: FirmView[];
  firmsLoading: boolean;
  /** Shown when there is no cohort or no prior decision to report; nothing by default. */
  empty?: React.ReactNode;
}): React.ReactElement | null {
  const { data: decisionData, isLoading: decisionsLoading } = useOsdkObjects(ReviewDecision, {
    orderBy: { decidedAt: "desc" },
    autoFetchMore: true,
  });

  const cohortIds = React.useMemo(() => {
    const s = new Set<string>();
    const t = firm.firmType ?? null;
    const g = firm.employeeGroup ?? null;
    if (t === null && g === null) {
      return s;
    }
    for (const f of allFirms) {
      if (f.firmId === firm.firmId) {
        continue;
      }
      if (t !== null && f.firmType !== t) {
        continue;
      }
      if (g !== null && f.employeeGroup !== g) {
        continue;
      }
      if (f.firmId) {
        s.add(f.firmId);
      }
    }
    return s;
  }, [allFirms, firm.firmId, firm.firmType, firm.employeeGroup]);

  // Both queries feed the prose — decisions AND the firm cohort come from
  // separate Firm / ReviewDecision streams that finish independently. If
  // we render before either resolves, an interpolated count would come out
  // as an empty slot ("You've reviewed  similar firms."). Track both and
  // show a skeleton until they're settled.
  const anyPending =
    firmsLoading ||
    decisionsLoading ||
    decisionData === undefined ||
    // firmType is our cohort key — no cohort key means allFirms is still
    // hydrating (or this firm genuinely has no cohort; either way, wait).
    (firmsLoading && allFirms.length === 0);

  const banner = React.useMemo(() => {
    if (anyPending || cohortIds.size === 0 || decisionData === undefined) {
      return null;
    }
    const decisions = decisionData.filter(
      (d) => d.firmId !== null && d.firmId !== undefined && cohortIds.has(d.firmId),
    );
    if (decisions.length === 0) {
      return null;
    }
    const uniqueFirms = new Set(decisions.map((d) => d.firmId ?? "")).size;
    let rejects = 0;
    let advances = 0;
    const rationales = new Map<string, number>();
    for (const d of decisions) {
      // decisionType comes from the backend as free-form strings —
      // "reject", "hard_reject", "advance", "qualify", "outreach",
      // "accept", "enrich", "re_engage", "keep_passed", "activity".
      // We bucket into two states an analyst cares about: rejects vs
      // "advanced-in-some-way". Being inclusive on the second bucket
      // avoids the blank-count symptom where nothing matched the
      // classifier and the strong element rendered empty.
      const type = (d.decisionType ?? "").toLowerCase();
      if (type.includes("reject")) {
        rejects++;
        const r = (d.rejectionRationale ?? "").trim();
        if (r !== "") {
          rationales.set(r, (rationales.get(r) ?? 0) + 1);
        }
      } else if (type !== "") {
        // Anything non-reject counts as forward motion (advance / qualify
        // / outreach / accept / enrich / re_engage / keep_passed / etc).
        advances++;
      }
    }
    let topRationale: { text: string; count: number } | null = null;
    for (const [text, count] of rationales) {
      if (topRationale === null || count > topRationale.count) {
        topRationale = { text, count };
      }
    }
    return { uniqueFirms, rejects, advances, topRationale };
  }, [decisionData, anyPending, cohortIds]);

  // Skeleton while pending — a soft shimmering bar the same height as the
  // final strip so the surrounding layout doesn't jump when counts arrive.
  if (anyPending) {
    return <DecisionMemorySkeleton />;
  }
  if (banner === null || banner.uniqueFirms <= 0) {
    // Nothing meaningful to say (no cohort or no prior decisions).
    return <>{empty}</>;
  }

  const cohortLabel = describeCohort(firm);
  // Coerce defensively — banner values are numbers by construction, but
  // rendering `undefined` interpolated into <strong> shows as blank. The
  // Number() + `|| 0` idiom guarantees a numeric display no matter what.
  const uniqueFirms = Number(banner.uniqueFirms) || 0;
  const rejects = Number(banner.rejects) || 0;
  const advances = Number(banner.advances) || 0;
  const hasRationale = banner.topRationale !== null && banner.topRationale.text.trim() !== "";
  const rationaleText = banner.topRationale ? truncateAtWord(banner.topRationale.text, 60) : "";
  const rationaleCount = banner.topRationale?.count ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        style={{ flex: "none" }}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      {/* Single flowing sentence — every dynamic value is inline text
          inside one <span> so nothing wraps to a new line or renders as a
          nested block. Numbers wrap in <strong>; the rationale uses <em>
          without decorative quotes so the sentence reads naturally. */}
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
          display: "inline",
        }}
      >
        You&rsquo;ve reviewed <strong style={{ fontWeight: 600 }}>{uniqueFirms}</strong>{" "}
        {cohortLabel} firm{uniqueFirms === 1 ? "" : "s"}.
        {rejects > 0 && (
          <>
            {" "}
            <strong style={{ fontWeight: 600 }}>{rejects}</strong> passed
            {hasRationale && banner.topRationale ? (
              <>
                {" "}
                &mdash; most-cited reason:{" "}
                <em
                  style={{
                    fontStyle: "italic",
                    color: "var(--color-text)",
                    display: "inline",
                  }}
                  title={banner.topRationale.text}
                >
                  {rationaleText}
                </em>
                {rationaleCount > 1 ? ` (${rationaleCount}×)` : ""}
              </>
            ) : null}
            {advances > 0 ? " · " : "."}
          </>
        )}
        {advances > 0 && (
          <>
            <strong style={{ fontWeight: 600 }}>{advances}</strong> advanced.
          </>
        )}
      </span>
    </div>
  );
}

function DecisionMemorySkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="Loading decision precedent"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)",
      }}
    >
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: "color-mix(in srgb, var(--color-text) 12%, transparent)",
          flex: "none",
        }}
      />
      <span
        style={{
          display: "block",
          height: 12,
          borderRadius: "var(--radius-sm)",
          flex: 1,
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 6%, transparent) 0%, color-mix(in srgb, var(--color-text) 18%, transparent) 50%, color-mix(in srgb, var(--color-text) 6%, transparent) 100%)",
          backgroundSize: "200% 100%",
          animation: "beacon-shimmer 1.6s linear infinite",
        }}
      />
    </div>
  );
}
