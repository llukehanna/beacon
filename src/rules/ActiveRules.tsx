import React from "react";
import { type ScreenableFirm } from "@/desk/activeScreening";
import { type RejectionNote } from "@/desk/ruleEvidence";
import { repairTruncatedText } from "@/desk/ruleText";
import { SectionHead } from "@/home/SectionHead";
import { Button, Panel } from "@/ui";
import { type FirmView } from "../../shared/deskModel";
import styles from "./ActiveRules.module.css";
import { AmendForm, UnapproveConfirm } from "./RuleChanges";
import { RuleEvidence } from "./RuleEvidence";
import { PredicateCode, RuleMeta } from "./RuleParts";
import {
  NO_VERSIONS,
  type RuleLike,
  type RuleVersions,
  currentVersion,
  displayDecider,
  effectivePredicate,
  parseSupportingIds,
  toggleDetails,
  versionHistory,
} from "./rulesModel";
import { useRuleScreen } from "./useRuleScreen";

interface RowProps {
  rule: RuleLike;
  notes: RejectionNote[];
  explainModel: boolean;
  versions: RuleVersions;
  firms: readonly (ScreenableFirm & FirmView)[];
}

/** The longer account of a rule: scope, what it screens, the rejections behind it and its versions. */
function RuleDetails({ rule, notes, explainModel, versions, firms }: RowProps): React.ReactElement {
  const screen = useRuleScreen(rule, versions, firms);
  const supporting = parseSupportingIds(rule.supportingDecisionIds);
  const basisCount = rule.supportingFirmCount ?? supporting.length;
  return (
    <div className={styles.details}>
      <RuleMeta rule={rule} explainModel={explainModel} />
      {screen.unavailable && (
        <p className={styles.note}>
          {screen.textRule
            ? "Screen count isn’t available for text-based rules. They still screen matching firms in the queue."
            : "Screen count isn’t available for this rule."}
        </p>
      )}
      {versions.all.length > 1 && (
        <p
          className={styles.history}
          title="Version history: v1 is the original approved predicate"
        >
          {versionHistory(versions)}
        </p>
      )}
      <RuleEvidence basisCount={basisCount} notes={notes} supportingCount={supporting.length} />
    </div>
  );
}

type Mode = "amend" | "unapprove" | null;

/** One approved rule as a table row, with a second row for details and its two changes. */
function ActiveRuleRow(props: RowProps): React.ReactElement {
  const { rule, versions, firms } = props;
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>(null);
  const screen = useRuleScreen(rule, versions, firms);

  const effective = versions.activeLatest;
  const predicate = effectivePredicate(rule, versions);
  const version = currentVersion(versions);
  const amended = versions.all.length > 1;
  const by = displayDecider(effective?.configAuthor ?? rule.ruleDecidedBy);
  const expanded = detailsOpen || mode !== null;
  const detailId = `rule-detail-${rule.proposedRuleId}`;

  return (
    <>
      <tr className={styles.row} data-open={expanded || undefined}>
        <td className={styles.ruleCell}>
          <PredicateCode predicate={predicate} />
          {rule.rationaleClusterSummary && (
            <div className={styles.summary} title={rule.rationaleClusterSummary}>
              {repairTruncatedText(rule.rationaleClusterSummary)}
            </div>
          )}
        </td>
        <td>
          {effective ? (
            <span className={styles.version} title={`Version ${version ?? "?"} · active config`}>
              v{version ?? "?"}
            </span>
          ) : (
            <span className={styles.none}>—</span>
          )}
        </td>
        <td className={styles.num}>
          {screen.projected !== null ? (
            <>
              {screen.projected}
              <span className={styles.unit}> firm{screen.projected === 1 ? "" : "s"}</span>
              {screen.projectedOpen !== null && screen.projectedOpen !== screen.projected && (
                <span className={styles.unit}> ({screen.projectedOpen} still open)</span>
              )}
            </>
          ) : (
            <span
              className={styles.none}
              title="This page cannot count the firms a text-based rule screens."
            >
              —
            </span>
          )}
        </td>
        <td className={styles.by}>
          {effective ? `${amended ? "amended" : "approved"} by ${by}` : `approved by ${by}`}
        </td>
        <td className={styles.actionCell}>
          <div className={styles.actions}>
            <Button
              variant="ghost"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => {
                const next = toggleDetails({ detailsOpen, mode });
                setDetailsOpen(next.detailsOpen);
                setMode(next.mode);
              }}
            >
              {expanded ? "Hide details" : "Details"}
            </Button>
            {mode === null && (
              <>
                <Button onClick={() => setMode("amend")}>Amend threshold…</Button>
                <Button variant="ghost" onClick={() => setMode("unapprove")}>
                  Unapprove
                </Button>
              </>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={5} id={detailId}>
            {mode === "amend" && (
              <AmendForm rule={rule} versions={versions} onDone={() => setMode(null)} />
            )}
            {mode === "unapprove" && <UnapproveConfirm rule={rule} onDone={() => setMode(null)} />}
            {detailsOpen && <RuleDetails {...props} />}
          </td>
        </tr>
      )}
    </>
  );
}

/** The approved rules, each with the predicate the engine is screening on and its version. */
export function ActiveRules({
  rules,
  notesByRule,
  versionsByRule,
  firms,
  explainModelId,
}: {
  rules: readonly RuleLike[];
  notesByRule: ReadonlyMap<string, RejectionNote[]>;
  versionsByRule: ReadonlyMap<string, RuleVersions>;
  firms: readonly (ScreenableFirm & FirmView)[];
  explainModelId: string | undefined;
}): React.ReactElement {
  return (
    <Panel className={styles.panel} aria-label="Active rules">
      <SectionHead title="Active rules" count={rules.length} />
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Version</th>
              <th scope="col" className={styles.numHead}>
                Screens
              </th>
              <th scope="col">Decided by</th>
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <ActiveRuleRow
                key={r.proposedRuleId}
                rule={r}
                notes={notesByRule.get(r.proposedRuleId) ?? []}
                explainModel={r.proposedRuleId === explainModelId}
                versions={versionsByRule.get(r.proposedRuleId) ?? NO_VERSIONS}
                firms={firms}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
