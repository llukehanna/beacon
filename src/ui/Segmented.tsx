import styles from "./Segmented.module.css";

/**
 * The app's single two-or-three-way choice: the hard-gate Pass/Fail rows, the conflict prompt and
 * the mandate form's archetype and priority.
 *
 * A radiogroup of `role="radio"` buttons whose `aria-checked` drives the selected styling, so the
 * visual state and the accessible state cannot drift apart. Options are compared with Object.is,
 * so `value` may be a boolean, string or number; the hard gates store a polarity-mapped boolean
 * where "Pass" is whichever value clears that specific gate.
 */

export interface SegmentedOption<T> {
  label: string;
  value: T;
  /** Optional per-option tooltip. */
  title?: string;
}

export function Segmented<T>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  block = false,
  disabled = false,
  onFocus,
}: {
  options: readonly SegmentedOption<T>[];
  /** Current selection. `undefined` renders every option unselected. */
  value: T | undefined;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Stretch the control to fill its container. */
  block?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
}) {
  return (
    <div
      className={block ? `${styles.seg} ${styles.block}` : styles.seg}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {options.map((opt) => {
        const checked = value !== undefined && Object.is(opt.value, value);
        return (
          <button
            key={opt.label}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            className={styles.option}
            title={opt.title}
            onFocus={onFocus}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
