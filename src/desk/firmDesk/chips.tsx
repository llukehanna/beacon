import React from "react";

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
