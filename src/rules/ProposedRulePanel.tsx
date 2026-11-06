import React from "react";
import { useOsdkAction } from "@/data/hooks";
import { approveRuleAction, dismissRuleAction } from "@/data/ontology";
import { type ScreenableFirm } from "@/desk/activeScreening";
import { type RejectionNote } from "@/desk/ruleEvidence";
import { summarizePredicate } from "@/desk/rulePredicate";
import { repairTruncatedText } from "@/desk/ruleText";
import { type Command, useCommands } from "@/shell/commands";
import { Button, Notice, Panel, StatusPill, Textarea } from "@/ui";
import styles from "./ProposedRulePanel.module.css";
import { RuleEvidence } from "./RuleEvidence";
import { PredicateCode, RuleMeta } from "./RuleParts";
import { type RuleLike, type RuleVersions, parseSupportingIds } from "./rulesModel";
import { useRuleScreen } from "./useRuleScreen";

/**
 * A proposal waiting for a decision: the rule in plain English, the predicate it would screen on,
 * the rejections it was drafted from and what it would do to the queue. Approve adds a versioned
 * hard-screen rule; declining needs a reason, which stays in the box if the action fails.
 */
export function ProposedRulePanel({
  rule,
  notes,
  explainModel,
  versions,
  firms,
}: {
  rule: RuleLike;
  /** The analysts' rejection notes behind this rule, newest first. */
  notes: RejectionNote[];
  /** True on the one panel per page that wraps "Model: both" in a glossary tooltip. */
  explainModel: boolean;
  versions: RuleVersions;
  firms: readonly ScreenableFirm[];
}): React.ReactElement {
  const approve = useOsdkAction(approveRuleAction);
  const dismiss = useOsdkAction(dismissRuleAction);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    if (declineOpen) {
      reasonRef.current?.focus();
    }
  }, [declineOpen]);

  const screen = useRuleScreen(rule, versions, firms);
  const predicate = summarizePredicate(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold);
  const supporting = parseSupportingIds(rule.supportingDecisionIds);
  const basisCount = rule.supportingFirmCount ?? supporting.length;
  const busy = approve.isPending || dismiss.isPending;

  const onApprove = (): void => {
    if (busy) {
      return;
    }
    void approve.applyAction({ proposedRule: rule } as never).catch(() => undefined);
  };
  const onDecline = (): void => {
    // The reason is cleared only on success, so a failure does not lose what was typed.
    void dismiss
      .applyAction({ proposedRule: rule, reason: reason.trim() } as never)
      .then(() => {
        setReason("");
        setDeclineOpen(false);
      })
      .catch(() => undefined);
  };
  const canDecline = reason.trim().length > 0 && !dismiss.isPending;

  // The palette runs the latest handlers without being re-registered on every render.
  const latest = React.useRef({ onApprove });
  latest.current = { onApprove };
  const ruleId = rule.proposedRuleId;
  const commands = React.useMemo<Command[]>(() => {
    if (predicate === null) {
      return [];
    }
    return [
      {
        id: `rules:approve:${ruleId}`,
        label: `Approve rule: ${predicate}`,
        group: "Actions",
        run: () => latest.current.onApprove(),
      },
      {
        id: `rules:decline:${ruleId}`,
        label: `Decline rule: ${predicate}…`,
        group: "Actions",
        run: () => setDeclineOpen(true),
      },
    ];
  }, [ruleId, predicate]);
  useCommands(commands);

  return (
    <Panel className={styles.panel} aria-label={predicate ?? "Proposed rule"}>
      <div className={styles.top}>
        <PredicateCode predicate={predicate} />
        <StatusPill status="proposed" />
      </div>

      {rule.rationaleClusterSummary && (
        <p className={styles.plain} title={rule.rationaleClusterSummary}>
          {repairTruncatedText(rule.rationaleClusterSummary)}
        </p>
      )}
      <RuleMeta rule={rule} explainModel={explainModel} />

      <RuleEvidence basisCount={basisCount} notes={notes} supportingCount={supporting.length} />

      {screen.projected !== null && (
        <Notice tone="accent">
          If approved, this rule would screen <b className={styles.figure}>{screen.projected}</b>{" "}
          firm{screen.projected === 1 ? "" : "s"} from your current queue.
        </Notice>
      )}
      {screen.unavailable && (
        <Notice tone="muted">
          {screen.textRule
            ? "Screen count isn’t available for text-based rules. Once approved, they still screen matching firms in the queue."
            : "Screen count isn’t available for this rule."}
        </Notice>
      )}

      {(approve.error !== undefined || dismiss.error !== undefined) && (
        <Notice>
          {approve.error !== undefined && <div>Approve failed: {String(approve.error)}</div>}
          {dismiss.error !== undefined && (
            <div>Decline failed: {String(dismiss.error)}. Your reason is preserved.</div>
          )}
        </Notice>
      )}

      {!declineOpen ? (
        <div className={styles.actions}>
          <div className={styles.buttons}>
            <Button variant="primary" disabled={busy} onClick={onApprove}>
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
            <Button disabled={busy} onClick={() => setDeclineOpen(true)}>
              Decline…
            </Button>
          </div>
          <span className={styles.hint}>Approving adds a versioned hard-screen rule by you.</span>
        </div>
      ) : (
        <div className={styles.decline}>
          <label htmlFor={`decline-${ruleId}`} className={styles.hint}>
            A reason is required to decline.
          </label>
          <Textarea
            id={`decline-${ruleId}`}
            ref={reasonRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why decline this proposal?"
            aria-label="Reason to decline this proposal"
          />
          <div className={styles.buttons}>
            <Button variant="primary" disabled={!canDecline} onClick={onDecline}>
              {dismiss.isPending ? "Declining…" : "Decline"}
            </Button>
            <Button
              variant="ghost"
              disabled={dismiss.isPending}
              onClick={() => setDeclineOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
