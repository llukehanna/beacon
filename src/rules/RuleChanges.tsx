import React from "react";
import { useOsdkAction } from "@/data/hooks";
import { amendRuleThresholdAction, unapproveRuleAction } from "@/data/ontology";
import { Button, Input, Notice } from "@/ui";
import styles from "./RuleChanges.module.css";
import { type RuleLike, type RuleVersions } from "./rulesModel";

/** Form to give an active rule a new threshold; it becomes the next version of the rule. */
export function AmendForm({
  rule,
  versions,
  onDone,
}: {
  rule: RuleLike;
  versions: RuleVersions;
  onDone: () => void;
}): React.ReactElement {
  const amend = useOsdkAction(amendRuleThresholdAction);
  const effective = versions.activeLatest;
  const [value, setValue] = React.useState(effective?.configThreshold ?? rule.ruleThreshold ?? "");
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Focus moves into the field when the form opens; the autoFocus prop can hijack focus in ways
  // screen readers do not expect.
  React.useEffect(() => inputRef.current?.focus(), []);

  const canSave = value.trim() !== "" && !amend.isPending;
  const save = (): void => {
    if (!canSave) {
      return;
    }
    // The threshold goes through as typed; the action accepts any comparable and the ontology
    // round-trips the raw value onto the new HardScreenConfig row.
    void amend
      .applyAction({ proposedRule: rule, newThreshold: value.trim() } as never)
      .then(onDone)
      .catch(() => undefined);
  };
  const axis = effective?.configAxis ?? rule.predicateAxis ?? "";
  const operator = effective?.configOperator ?? rule.ruleOperator ?? "";

  return (
    <div className={styles.form}>
      <label htmlFor={`amend-${rule.proposedRuleId}`} className={styles.label}>
        New threshold for{" "}
        <code className={styles.code}>
          {axis} {operator}
        </code>
      </label>
      <div className={styles.inline}>
        <Input
          id={`amend-${rule.proposedRuleId}`}
          ref={inputRef}
          className={styles.number}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              save();
            }
          }}
          aria-label="New threshold value"
        />
        <Button variant="primary" disabled={!canSave} onClick={save}>
          {amend.isPending ? "Amending…" : "Save"}
        </Button>
        <Button variant="ghost" disabled={amend.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className={styles.hint}>
        Creates a new version. Firms the old threshold caught but this one doesn&rsquo;t re-enter
        the queue.
      </p>
      {amend.error !== undefined && (
        <Notice>Amend failed: {String(amend.error)}. Your value is preserved.</Notice>
      )}
    </div>
  );
}

/** Confirmation before an active rule goes back to Pending. */
export function UnapproveConfirm({
  rule,
  onDone,
}: {
  rule: RuleLike;
  onDone: () => void;
}): React.ReactElement {
  const unapprove = useOsdkAction(unapproveRuleAction);
  const confirm = (): void => {
    void unapprove
      .applyAction({ proposedRule: rule } as never)
      .then(onDone)
      .catch(() => undefined);
  };
  return (
    <div role="alertdialog" aria-label="Unapprove this rule?" className={styles.confirm}>
      <div className={styles.confirmTitle}>Unapprove this rule?</div>
      <p className={styles.confirmBody}>
        The screen stops firing immediately and the rule returns to Pending. Firms caught only by
        this predicate re-enter the queue.
      </p>
      <div className={styles.inline}>
        <Button disabled={unapprove.isPending} onClick={confirm}>
          {unapprove.isPending ? "Unapproving…" : "Yes, unapprove"}
        </Button>
        <Button variant="ghost" disabled={unapprove.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
      {unapprove.error !== undefined && (
        <Notice>Unapprove failed: {String(unapprove.error)}</Notice>
      )}
    </div>
  );
}
