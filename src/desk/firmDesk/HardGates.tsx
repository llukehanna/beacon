import React from "react";
import { Term } from "@/components/Term";
import { Segmented } from "../Segmented";
import { Kicker } from "./chips";
import { type EditMap, type FirmView } from "./deskModel";
import { HARD_GATES } from "./hardGateConfig";

export function HardGates({
  firm,
  edits,
  setAxis,
  focused,
  setFocused,
}: {
  firm: FirmView;
  edits: EditMap;
  setAxis: (key: string, value: string | number | boolean) => void;
  focused: string | undefined;
  setFocused: (k: string | undefined) => void;
}): React.ReactElement {
  return (
    <div>
      <Kicker style={{ marginBottom: 8 }}>
        <Term id="Hard gate">Hard gates</Term>
      </Kicker>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {HARD_GATES.map((g) => {
          const editVal = edits[g.editKey];
          const onFile = firm[g.readKey];
          const effective =
            typeof editVal === "boolean" ? editVal : (onFile as boolean | null | undefined);
          const isFocused = focused === `gate:${g.editKey}`;
          return (
            <div
              key={g.editKey}
              style={{
                padding: 12,
                background: "var(--color-surface)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                outline: isFocused ? "1px solid var(--color-accent)" : "none",
              }}
              onFocus={() => setFocused(`gate:${g.editKey}`)}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {g.label === "S&T / balance sheet" ? (
                    <Term id="S&T / balance sheet">{g.label}</Term>
                  ) : (
                    g.label
                  )}
                </div>
                {g.helper && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                      marginTop: 1,
                    }}
                  >
                    {g.helper}
                  </div>
                )}
              </div>
              <Segmented<boolean>
                block
                ariaLabel={`${g.label}: Pass or Fail`}
                // Pass always means "cleared" — the underlying bool is
                // whatever passWhen resolves to for this gate. Two of the
                // four gates invert (advisoryConflict, hasStOrBalanceSheet).
                options={[
                  { label: "Pass", v: g.passWhen },
                  { label: "Fail", v: !g.passWhen },
                ].map((o) => ({ label: o.label, value: o.v }))}
                value={typeof effective === "boolean" ? effective : undefined}
                onFocus={() => setFocused(`gate:${g.editKey}`)}
                onChange={(v) => {
                  setFocused(`gate:${g.editKey}`);
                  setAxis(g.editKey, v);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
