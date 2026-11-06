import React from "react";
import { Segmented } from "../../Segmented";
import { type FindingLike } from "../../axisState";
import {
  FINDING_AXIS_TO_KEY,
  HARD_GATE_PASS_WHEN,
  NUMERIC_UNIT,
  axisInputKind,
  coerceFindingValue,
} from "../../findingActions";
import { type Model } from "../../scoreMirror";
import { FindingStatusChip } from "../chips";
import { displayAxis, enumOptionsFor, findingCardShell } from "../deskModel";

export function AbstainFindingCard({
  finding,
  firmModel,
  applyEdit,
}: {
  finding: FindingLike;
  firmModel: Model;
  // Typed apply — mirrors AxisCard so the abstain path doesn't need to
  // round-trip through the legacy coerce-in-parent handler.
  applyEdit: (editKey: string, value: string | number | boolean) => void;
}): React.ReactElement {
  const rawAxis = (finding.axis ?? "").trim().toLowerCase();
  const editKey = FINDING_AXIS_TO_KEY[rawAxis];
  const kind = editKey === undefined ? "text" : axisInputKind(editKey);
  const [text, setText] = React.useState("");
  const border = "1px solid color-mix(in srgb, #f07167 45%, transparent)";

  const submitText = (): void => {
    if (editKey === undefined || text.trim() === "") {
      return;
    }
    const coerced = coerceFindingValue(editKey, text);
    if (coerced === undefined) {
      return;
    }
    applyEdit(editKey, coerced);
    setText("");
  };

  const submitBool = (v: boolean): void => {
    if (editKey === undefined) {
      return;
    }
    applyEdit(editKey, v);
  };

  const submitEnum = (v: string): void => {
    if (editKey === undefined || v === "") {
      return;
    }
    applyEdit(editKey, v);
  };

  const shell = (body: React.ReactNode): React.ReactElement => (
    <div style={findingCardShell(border)}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
      >
        <span
          style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 52%, transparent)" }}
        >
          {displayAxis(finding.axis)}
        </span>
        <FindingStatusChip status={"abstained"} />
      </div>
      <div style={{ fontSize: 13, color: "#f4948b", marginTop: 4, fontWeight: 500 }}>
        No source had this, needs you
      </div>
      {body}
    </div>
  );

  // Axis the client can't route to a firm field — degrade to disabled text
  // input with a note rather than pretending the input does anything.
  if (editKey === undefined) {
    return shell(
      <div style={{ marginTop: 8, fontSize: 11, color: "#f4948b" }}>
        Not routable. Enter this value in the axis breakdown above.
      </div>,
    );
  }

  if (kind === "boolean") {
    const passWhen = HARD_GATE_PASS_WHEN[editKey] ?? true;
    return shell(
      <Segmented<boolean>
        style={{ marginTop: 8 }}
        ariaLabel={`${displayAxis(finding.axis)}: Pass or Fail`}
        options={[
          { label: "Pass", value: passWhen },
          { label: "Fail", value: !passWhen },
        ]}
        // The conflict prompt asks for a fresh call; nothing is preselected.
        value={undefined}
        onChange={submitBool}
      />,
    );
  }

  if (kind === "enum") {
    const options = enumOptionsFor(editKey, firmModel);
    return shell(
      <div style={{ marginTop: 8, display: "flex", gap: 6, flexDirection: "column" }}>
        <select
          className="input"
          value=""
          onChange={(e) => submitEnum(e.target.value)}
          style={{ height: 32 }}
          aria-label={`${displayAxis(finding.axis)} value`}
        >
          <option value="" disabled>
            Pick a value…
          </option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>,
    );
  }

  const numeric = kind === "number";
  const unit = numeric ? NUMERIC_UNIT[editKey] : undefined;
  return shell(
    <>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <input
          className="input"
          type={numeric ? "number" : "text"}
          inputMode={numeric ? "decimal" : undefined}
          placeholder={numeric ? "0" : "Enter value…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submitText();
            }
          }}
          style={{
            flex: 1,
            height: 32,
            borderColor: "color-mix(in srgb, #f07167 40%, transparent)",
          }}
        />
        {unit !== undefined && (
          <span
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              whiteSpace: "nowrap",
            }}
          >
            {unit}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: "3px 10px" }}
          disabled={text.trim() === ""}
          onClick={submitText}
        >
          Fill from analyst
        </button>
      </div>
    </>,
  );
}
