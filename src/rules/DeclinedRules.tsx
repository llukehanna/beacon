import React from "react";
import { type RejectionNote } from "@/desk/ruleEvidence";
import { summarizePredicate } from "@/desk/rulePredicate";
import { repairTruncatedText } from "@/desk/ruleText";
import { SectionHead } from "@/home/SectionHead";
import { Button, Panel } from "@/ui";
import styles from "./DeclinedRules.module.css";
import { RuleEvidence } from "./RuleEvidence";
import { PredicateCode, RuleMeta } from "./RuleParts";
import { type RuleLike, displayDecider, parseSupportingIds, statusOf } from "./rulesModel";

function DeclinedRow({
  rule,
  notes,
  explainModel,
}: {
  rule: RuleLike;
  notes: RejectionNote[];
  explainModel: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const status = statusOf(rule);
  const supporting = parseSupportingIds(rule.supportingDecisionIds);
  const basisCount = rule.supportingFirmCount ?? supporting.length;
  const predicate = summarizePredicate(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold);
  const detailId = `declined-${rule.proposedRuleId}`;
  return (
    <li className={styles.item}>
      <div className={styles.row}>
        <PredicateCode predicate={predicate} />
        <span className={styles.who}>
          {status === "dismissed" ? "Declined" : rule.ruleStatus} · by{" "}
          {displayDecider(rule.ruleDecidedBy)}
        </span>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide details" : "Details"}
        </Button>
      </div>
      {open && (
        <div className={styles.details} id={detailId}>
          {rule.rationaleClusterSummary && (
            <p className={styles.summary}>{repairTruncatedText(rule.rationaleClusterSummary)}</p>
          )}
          <RuleMeta rule={rule} explainModel={explainModel} />
          <RuleEvidence basisCount={basisCount} notes={notes} supportingCount={supporting.length} />
        </div>
      )}
    </li>
  );
}

/** Proposals the analyst turned down, kept for the record. */
export function DeclinedRules({
  rules,
  notesByRule,
  explainModelId,
}: {
  rules: readonly RuleLike[];
  notesByRule: ReadonlyMap<string, RejectionNote[]>;
  explainModelId: string | undefined;
}): React.ReactElement {
  return (
    <Panel className={styles.panel} aria-label="Declined rules">
      <SectionHead title="Declined" count={rules.length} />
      <ul className={styles.list}>
        {rules.map((r) => (
          <DeclinedRow
            key={r.proposedRuleId}
            rule={r}
            notes={notesByRule.get(r.proposedRuleId) ?? []}
            explainModel={r.proposedRuleId === explainModelId}
          />
        ))}
      </ul>
    </Panel>
  );
}
