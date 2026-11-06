import React from "react";
import { modelChipTitle, modelLabel } from "../sourceHighlight";
import { BAND_COLOR, CONFIDENCE_CHIP, FINDING_CHIP, providerLabel } from "../tokens";

// Nocturne kicker — 10-11px uppercase 0.12em tracking, ~45% text.
export function Kicker({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function BandChip({ band }: { band: 0 | 1 | 2 | null }): React.ReactElement | null {
  if (band === null) {
    return null;
  }
  const c = BAND_COLOR[band];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "var(--radius-chip)",
        fontSize: 11,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: c.fg,
        background: c.bg,
      }}
    >
      {band}
    </span>
  );
}

export function ProviderChip({ provider }: { provider?: string }): React.ReactElement {
  // Findings with no provider are analyst-entered — badge them explicitly so
  // no card ever renders a bare em-dash where a source badge should be.
  const raw = provider ?? "";
  const label =
    raw === "" || raw.toLowerCase() === "none" || raw.toLowerCase() === "unknown"
      ? "Analyst"
      : providerLabel(raw);
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
      }}
    >
      {label}
    </span>
  );
}

export function ModelChip({ model }: { model?: string | null }): React.ReactElement | null {
  const label = modelLabel(model);
  if (label === null) {
    return null;
  }
  return (
    <span
      title={modelChipTitle(model)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
        border: "1px solid var(--color-divider)",
      }}
    >
      {label}
    </span>
  );
}

export function ConfidenceChip({ tier }: { tier?: string }): React.ReactElement {
  const key = (tier ?? "").toLowerCase();
  const known = CONFIDENCE_CHIP[key];
  const c = known ?? {
    label: tier ?? "—",
    fg: "var(--color-text)",
    bg: "var(--color-neutral-800)",
  };
  // "—" appears on analyst-entered rows (no model ran, so no confidence
  // tier). Everything else is the agent's own tier — label that so the
  // chip doesn't read as an unlabeled color swatch.
  const title = known
    ? "source confidence"
    : "n/a: human-entered values carry no model confidence.";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: c.fg,
        background: c.bg,
        cursor: "help",
      }}
    >
      {c.label}
    </span>
  );
}

export function FindingStatusChip({ status }: { status?: string }): React.ReactElement | null {
  const key = (status ?? "").toLowerCase();
  const c = FINDING_CHIP[key];
  if (!c) {
    return null;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: "var(--radius-chip)",
        color: c.fg,
        background: c.bg,
      }}
    >
      {c.label}
    </span>
  );
}

export function SectionHeader({
  label,
  count,
}: {
  label: string;
  count: number;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}
    >
      <Kicker>{label}</Kicker>
      <span
        style={{
          fontSize: 10,
          padding: "1px 6px",
          borderRadius: "var(--radius-chip)",
          background: "var(--color-neutral-800)",
          color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    </div>
  );
}
