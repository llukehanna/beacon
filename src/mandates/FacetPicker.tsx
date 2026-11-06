import React from "react";
import { Button, Input } from "@/ui";
import type { FacetGroup } from "../../shared/taxonomy";
import styles from "./FacetPicker.module.css";
import { customValues, hasValue, toggleCategory, toggleValue } from "./facetModel";

/**
 * Category tiles that expand to their sub-options when the category or any of them is picked, plus
 * custom entries for anything outside the taxonomy. Picking a category picks its sub-options too;
 * the sub-options stay individually toggleable.
 */
export function FacetPicker({
  label,
  helper,
  groups,
  values,
  onChange,
  customPlaceholder,
  gridId,
}: {
  label: string;
  helper: string;
  groups: readonly FacetGroup[];
  values: readonly string[];
  onChange: (next: string[]) => void;
  customPlaceholder: string;
  gridId: string;
}): React.ReactElement {
  const customs = React.useMemo(() => customValues(values, groups), [values, groups]);
  const [draft, setDraft] = React.useState("");
  const submitCustom = (): void => {
    const t = draft.trim();
    if (t !== "" && !hasValue(values, t)) {
      onChange([...values, t]);
    }
    setDraft("");
  };
  const inputId = `${gridId}-custom-input`;

  return (
    <div className={styles.picker}>
      <h2 className={styles.label}>{label}</h2>
      <p className={styles.helper}>{helper}</p>

      <div role="group" aria-label={label} className={styles.groups}>
        {groups.map((g) => {
          const catSelected = hasValue(values, g.label);
          const expanded = catSelected || g.subs.some((s) => hasValue(values, s));
          return (
            <div key={g.label} className={styles.group}>
              <button
                type="button"
                className={styles.category}
                aria-pressed={catSelected}
                onClick={() => onChange(toggleCategory(values, g, groups))}
              >
                <span className={styles.name}>{g.label}</span>
                {g.subs.length > 0 && (
                  <span
                    className={styles.subCount}
                    title={`${g.subs.length} sub-option${g.subs.length === 1 ? "" : "s"}`}
                  >
                    {g.subs.length}
                    <span aria-hidden="true">{expanded ? " ▾" : " ▸"}</span>
                  </span>
                )}
              </button>
              {expanded && g.subs.length > 0 && (
                <div className={styles.subs}>
                  {g.subs.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={styles.chip}
                      aria-pressed={hasValue(values, s)}
                      onClick={() => onChange(toggleValue(values, s))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {customs.length > 0 && (
        <div className={styles.customs}>
          <div className={styles.customLabel}>Custom</div>
          <div className={styles.subs}>
            {customs.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.chip}
                aria-pressed="true"
                aria-label={`Remove ${c}`}
                title={`Remove ${c}`}
                onClick={() => onChange(toggleValue(values, c))}
              >
                {c}
                <span aria-hidden="true" className={styles.remove}>
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.add}>
        <label htmlFor={inputId} className={styles.srOnly}>
          Add custom {label.toLowerCase()}
        </label>
        <Input
          id={inputId}
          value={draft}
          placeholder={customPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitCustom();
            }
          }}
        />
        <Button disabled={draft.trim() === ""} onClick={submitCustom}>
          Add
        </Button>
      </div>
    </div>
  );
}
