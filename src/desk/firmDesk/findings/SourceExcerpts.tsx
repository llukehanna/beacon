import React from "react";
import { ViewSourceButton } from "@/components/SourceDrawer";
import { type FindingLike } from "../../axisState";
import { excerptText } from "../../sourceHighlight";
import { Kicker, ProviderChip } from "../chips";

export function SourceExcerpts({
  findings,
}: {
  findings: FindingLike[];
}): React.ReactElement | null {
  // Cited values only: abstentions and analyst entries have no document to open.
  const withExcerpts = findings
    .filter(
      (f) =>
        f.sourceDocumentId &&
        f.sourceExcerpt &&
        ["proposed", "verified"].includes((f.findingStatus ?? "").toLowerCase()),
    )
    .slice(0, 4);
  if (withExcerpts.length === 0) {
    return null;
  }
  return (
    <div>
      <Kicker style={{ marginBottom: 8 }}>Source excerpts</Kicker>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {withExcerpts.map((f) => (
          <div
            key={f.findingId}
            style={{
              borderLeft: "2px solid var(--color-divider)",
              padding: "2px 0 2px 11px",
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: "color-mix(in srgb, var(--color-text) 82%, transparent)",
                fontStyle: "italic",
              }}
            >
              {excerptText(f)}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
              }}
            >
              <ProviderChip provider={f.provider} />
              <span
                style={{
                  fontSize: 10,
                  color: "color-mix(in srgb, var(--color-text) 42%, transparent)",
                }}
              >
                {f.axis ?? ""}
              </span>
              <ViewSourceButton finding={f} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
