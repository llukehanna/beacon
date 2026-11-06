import React from "react";
import { Button, Kbd, Segmented } from "@/ui";
import {
  HARD_GATE_PASS_WHEN,
  NUMERIC_UNIT,
  axisInputKind,
  coerceFindingValue,
  formatAxisValue,
} from "../findingActions";
import { type Model } from "../scoreMirror";
import styles from "./ValueEditor.module.css";
import { type AxisRow } from "./axisRows";
import { type EditMap, editorForEditKey, enumOptionsFor } from "./deskModel";

type Staged = string | number | boolean;

/**
 * The analyst's own value for an axis, with the editor that fits the axis: pass/fail for a gate,
 * the rubric's options for a categorical axis (the 0, 1 and 2 keys choose them), a number with
 * its unit, or free text. `onStage` receives the coerced value; nothing is written until Commit.
 */
export function ValueEditor({
  row,
  model,
  edits,
  current,
  onStage,
  stageLabel,
}: {
  row: AxisRow;
  model: Model;
  edits: EditMap;
  /** The value in effect now: a staged edit, else what is on the firm. */
  current: Staged | null | undefined;
  onStage: (value: Staged) => void;
  /** The label of the button that stages a typed value. */
  stageLabel: string;
}): React.ReactElement {
  const editKey = row.def.actionParam;
  const kind = axisInputKind(editKey);
  const [text, setText] = React.useState("");
  const staged = edits[editKey];

  const submitText = (): void => {
    const coerced = coerceFindingValue(editKey, text);
    if (coerced === undefined) {
      return;
    }
    onStage(coerced);
    setText("");
  };

  let control: React.ReactNode;
  if (kind === "boolean") {
    const passWhen = HARD_GATE_PASS_WHEN[editKey] ?? true;
    control = (
      <Segmented<boolean>
        ariaLabel={`${row.label}: Pass or Fail`}
        options={[
          { label: "Pass", value: passWhen },
          { label: "Fail", value: !passWhen },
        ]}
        value={typeof current === "boolean" ? current : undefined}
        onChange={onStage}
      />
    );
  } else if (kind === "enum") {
    const options = editorForEditKey(editKey, model)?.options;
    const labels = options?.map((o) => o.label) ?? enumOptionsFor(editKey, model);
    control = (
      <div className={styles.options} role="radiogroup" aria-label={`${row.label} value`}>
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={current === label}
            className={styles.option}
            onClick={() => onStage(label)}
          >
            <Kbd>{String(options?.[i]?.score ?? i)}</Kbd>
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  } else {
    const numeric = kind === "number";
    const unit = numeric ? NUMERIC_UNIT[editKey] : undefined;
    control = (
      <div className={styles.typed}>
        <input
          className={`input ${styles.input}`}
          type={numeric ? "number" : "text"}
          inputMode={numeric ? "decimal" : undefined}
          placeholder={
            current !== null && current !== undefined && typeof current !== "boolean"
              ? String(current)
              : numeric
                ? "0"
                : "Enter value…"
          }
          aria-label={`${row.label} value`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submitText();
            }
          }}
        />
        {unit !== undefined && <span className={styles.unit}>{unit}</span>}
        <Button variant="primary" disabled={text.trim() === ""} onClick={submitText}>
          {stageLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      {control}
      {staged !== undefined && staged !== "" && (
        <p className={styles.staged}>Staged for commit: {formatAxisValue(editKey, staged)}</p>
      )}
    </div>
  );
}
