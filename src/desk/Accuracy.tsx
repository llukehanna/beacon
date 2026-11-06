import React from "react";
import { Term } from "@/components/Term";
import { useOsdkQuery } from "@/data/hooks";
import type { AccuracySummary } from "../../shared/summaries";
import "./nocturne.css";
import {
  DIVERGENCE_BG,
  DIVERGENCE_BORDER,
  DIVERGENCE_FG,
  outcomeChipStyle,
  outcomeLabel,
} from "./tokens";
// Aggregation semantics live in ./trustMetrics (the server's accuracySummary
// applies them) so the Home trust panel and this page quote identical rates.
import {
  INSUFFICIENT_THRESHOLD,
  NULL_OUTCOME_KEY,
  OUTCOME_SLOTS,
  type OutcomeTally,
  type Rates,
} from "./trustMetrics";

// Abstention is "no supported value": a fact about coverage, not a verdict,
// so it never takes the amber/red of override.
const ABSTENTION_COLOR = "color-mix(in srgb, var(--color-text) 72%, transparent)";

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

function ProviderChip({ label }: { label: string }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
        background: "var(--color-neutral-800)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// Cells with fewer than this many samples render "n=X" muted instead of a
// percentage — one override on a two-finding provider shouldn't read as
// "Deal DB 100% wrong".
const MIN_SAMPLE = 5;

// Bar + percentage cell. Below the sample floor the cell falls back to a
// muted "n=X" so the reader can't mistake sparse data for a strong signal.
function RateCell({
  pct,
  sample,
  showBar,
  color,
}: {
  pct: number | null;
  sample: number;
  showBar: boolean;
  color: string;
}): React.ReactElement {
  const insufficientSample = sample < MIN_SAMPLE;
  const displayColor = insufficientSample
    ? "color-mix(in srgb, var(--color-text) 42%, transparent)"
    : color;
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        color: displayColor,
      }}
    >
      {showBar && !insufficientSample && (
        <span
          style={{
            width: 34,
            height: 4,
            borderRadius: "var(--radius-xs)",
            background: "var(--color-neutral-800)",
            position: "relative",
            overflow: "hidden",
            flex: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${pct ?? 0}%`,
              background: "var(--color-accent)",
              borderRadius: "var(--radius-xs)",
            }}
          />
        </span>
      )}
      {sample === 0 ? "—" : insufficientSample ? `n=${sample}` : pct === null ? "—" : `${pct}%`}
    </span>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────

function Accuracy(): React.ReactElement {
  // Aggregated on the server: a few kilobytes of rates instead of every finding and firm.
  const { data, isLoading, error } = useOsdkQuery<AccuracySummary>("accuracySummary");

  const insufficient = data !== undefined && data.overall.decided < INSUFFICIENT_THRESHOLD;

  return (
    <div
      className="dsn"
      style={{
        height: "100%",
        background: "transparent",
        display: "flex",
      }}
    >
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
            <span style={{ fontWeight: 500, fontSize: 16 }}>Trust metrics</span>
            <span
              style={{
                fontSize: 11,
                color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
              }}
            >
              {isLoading
                ? "Loading findings…"
                : "How often Beacon agreed with you, was overridden, or honestly abstained"}
            </span>
          </div>
        </header>

        {error && (
          <div
            style={{
              padding: "8px 24px",
              background: "rgba(240,113,103,.12)",
              color: "#f4948b",
              fontSize: 12,
            }}
          >
            {String(error)}
          </div>
        )}

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 1000,
          }}
        >
          {insufficient && (
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
                  background: "var(--color-neutral-800)",
                  display: "grid",
                  placeItems: "center",
                  color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
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
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-4 3 3 5-6" />
                </svg>
              </span>
              <div style={{ fontSize: 19, fontWeight: 600 }}>
                Trust metrics appear after {INSUFFICIENT_THRESHOLD} decided findings
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
                  maxWidth: "44ch",
                }}
              >
                Beacon needs a baseline of agent-vs-analyst decisions before agreement, override,
                and abstention rates are meaningful. {data?.overall.decided} decided so far. Keep
                reviewing.
              </p>
            </div>
          )}

          {data !== undefined && !insufficient && (
            <>
              {/* Headline on the left, what actually happened to the firms on the right. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 24,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    padding: 16,
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-divider)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Kicker>
                    <Term id="Abstention">Abstention</Term> rate
                  </Kicker>
                  <span
                    style={{
                      fontSize: 32,
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1.1,
                    }}
                  >
                    {data.overall.abstention}%
                  </span>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "color-mix(in srgb, var(--color-text) 65%, transparent)",
                    }}
                  >
                    Share of findings where Beacon recorded no value because no source stated one,
                    or the stated value had no supporting quote.
                  </div>
                </div>

                <OutcomesPanel tally={data.outcomes} />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 24,
                  alignItems: "start",
                }}
              >
                <MetricsTable
                  title="By provider"
                  rows={data.byProvider.map((p) => ({
                    key: p.key,
                    label: <ProviderChip label={p.label} />,
                    r: p.r,
                  }))}
                />
                <MetricsTable
                  title="By axis"
                  rows={data.byAxis.map((a) => ({
                    key: a.key,
                    label: (
                      <span
                        style={{
                          fontSize: 12,
                          color: "color-mix(in srgb, var(--color-text) 72%, transparent)",
                        }}
                      >
                        {a.label}
                      </span>
                    ),
                    r: a.r,
                  }))}
                />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
                  lineHeight: 1.55,
                  maxWidth: "72ch",
                }}
              >
                <strong style={{ fontWeight: 600 }}>Of decided</strong> = the agent proposed a value
                and you either accepted (agreement) or rejected it (override); abstains excluded.{" "}
                <strong style={{ fontWeight: 600 }}>Of all findings</strong> = every finding the
                agent produced for this group, abstains included, so the columns don&rsquo;t sum to
                100%.
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

interface MetricsRow {
  key: string;
  label: React.ReactNode;
  r: Rates;
}

function MetricsTable({ title, rows }: { title: string; rows: MetricsRow[] }): React.ReactElement {
  return (
    // Section header spacing comes from the parent gap, as on every other
    // page — Kicker used to carry its own marginBottom here, which made
    // Accuracy the one screen whose section headers sat at a different
    // offset from its siblings.
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Kicker>{title}</Kicker>
      {/* Group headers: agreement + override share a denominator (decided
          non-abstain findings), abstention uses a different one (all
          findings). Making that split visible prevents the "100% + 26%?"
          misread — the percentages are of different totals. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 2fr 1fr",
          gap: "4px 12px",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 38%, transparent)",
        }}
      >
        <span />
        <span
          style={{
            borderBottom: "1px solid color-mix(in srgb, var(--color-text) 18%, transparent)",
            paddingBottom: 3,
            textAlign: "center",
          }}
        >
          Of decided
        </span>
        <span
          style={{
            borderBottom: "1px solid color-mix(in srgb, var(--color-text) 18%, transparent)",
            paddingBottom: 3,
            textAlign: "center",
          }}
        >
          Of all findings
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
          gap: "9px 12px",
          fontSize: 11,
          color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
          marginTop: 4,
        }}
      >
        <span />
        <span>Agreement</span>
        <span>Override</span>
        <span>Abstention</span>
      </div>
      {rows.length === 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
          }}
        >
          No findings yet.
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            gap: "9px 12px",
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid var(--color-divider)",
          }}
          title={
            row.r.decided > 0
              ? `${row.r.decided} decided of ${row.r.total} total`
              : `${row.r.total} findings, none decided yet`
          }
        >
          {row.label}
          <RateCell pct={row.r.agreement} sample={row.r.decided} showBar={true} color="inherit" />
          <RateCell pct={row.r.override} sample={row.r.decided} showBar={false} color="#f3c978" />
          <RateCell
            pct={row.r.abstention}
            sample={row.r.total}
            showBar={false}
            color={ABSTENTION_COLOR}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Outcomes panel ─────────────────────────────────────────────────────
// Counts by outcome across every firm, plus a single headline: "Of firms
// we passed, N were later acquired — the drift loop exists to catch
// these." Counts and chips only, no charts. Outcomes that have been observed
// get a tile; firms with no outcome yet are one muted line, since that is the
// bulk of the funnel and a tile for it would out-shout the ones that matter.

function OutcomesPanel({ tally }: { tally: OutcomeTally }): React.ReactElement {
  const { counts, passed, passedAndAcquired } = tally;
  const observed = OUTCOME_SLOTS.filter((slot): slot is string => slot !== null);
  const notYet = counts[NULL_OUTCOME_KEY] ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Kicker>Outcomes</Kicker>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {observed.map((slot) => {
          const n = counts[slot] ?? 0;
          const style = outcomeChipStyle(slot);
          return (
            <div
              key={slot}
              style={{
                padding: 12,
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface)",
                border: `1px solid ${style.border}`,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 21,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: style.fg,
                }}
              >
                {n}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
                }}
              >
                {outcomeLabel(slot)}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
        }}
      >
        {notYet} {notYet === 1 ? "firm" : "firms"} with no outcome observed yet
      </div>

      {passed > 0 && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            // Divergence violet, matching the outcome chips above and the
            // outcome_diverged entries on /review. Red is for rejection.
            background: DIVERGENCE_BG,
            border: `1px solid ${DIVERGENCE_BORDER}`,
            fontSize: 13,
            color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
            lineHeight: 1.5,
          }}
        >
          Of firms we passed,{" "}
          <strong style={{ color: DIVERGENCE_FG, fontWeight: 600 }}>{passedAndAcquired}</strong>{" "}
          {passedAndAcquired === 1 ? "was" : "were"} later acquired. The drift loop exists to catch
          these.
        </div>
      )}
    </div>
  );
}

export default Accuracy;
