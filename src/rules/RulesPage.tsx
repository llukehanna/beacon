import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, HardScreenConfig, ProposedRule, ReviewDecision } from "@/data/ontology";
import { type ScreenableFirm } from "@/desk/activeScreening";
import { type RejectionNote, buildRejectionNotes } from "@/desk/ruleEvidence";
import { type Command, useCommands } from "@/shell/commands";
import { EmptyState, Notice, PageHeader, Skeleton } from "@/ui";
import { ActiveRules } from "./ActiveRules";
import { DeclinedRules } from "./DeclinedRules";
import { ProposeRulesButton } from "./ProposeRulesButton";
import { ProposedRulePanel } from "./ProposedRulePanel";
import styles from "./RulesPage.module.css";
import {
  type ConfigLike,
  type DecisionLike,
  NO_VERSIONS,
  type RuleLike,
  groupRules,
  groupVersions,
  parseSupportingIds,
} from "./rulesModel";
import { useProposeRules } from "./useProposeRules";

/**
 * Rules: the hard screens Beacon proposes from the analysts' own rejections. Proposals wait for an
 * approve or decline; approved rules are versioned, can be amended or unapproved, and take firms
 * off the desk queue.
 */
export default function RulesPage(): React.ReactElement {
  const {
    data: rulesData,
    isLoading,
    error,
  } = useOsdkObjects(ProposedRule, {
    autoFetchMore: true,
  });
  const { data: decisionsData } = useOsdkObjects(ReviewDecision, { autoFetchMore: true });
  const { data: firmsData } = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
  });
  // Every config row, so an approved rule shows its current version, effective predicate and
  // history. Amending adds a row and deactivates the last; unapproving deactivates them all. Both
  // invalidate this query.
  const { data: configsData } = useOsdkObjects(HardScreenConfig, { autoFetchMore: true });

  const propose = useProposeRules();
  const proposeCommands = React.useMemo<Command[]>(
    () => [
      {
        id: "rules:propose",
        label: "Propose rules from rejections",
        group: "Actions",
        run: propose.run,
      },
    ],
    [propose.run],
  );
  useCommands(proposeCommands);

  const rules = React.useMemo(() => (rulesData ?? []) as unknown as RuleLike[], [rulesData]);
  // The same Firm query the desk runs, so a rule's screen count is over the identical population.
  const firms = React.useMemo(() => (firmsData ?? []) as unknown as ScreenableFirm[], [firmsData]);

  // decisionId → decision and firmId → name, chained so a rule's supportingDecisionIds resolve to
  // the analysts' notes.
  const decisionById = React.useMemo(() => {
    const m = new Map<string, DecisionLike>();
    for (const d of (decisionsData ?? []) as unknown as DecisionLike[]) {
      m.set(d.decisionId, d);
    }
    return m;
  }, [decisionsData]);
  const firmNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firmsData ?? []) {
      if (f.firmId) {
        m.set(f.firmId, f.firmName ?? f.firmId);
      }
    }
    return m;
  }, [firmsData]);
  const versionsByRule = React.useMemo(
    () => groupVersions((configsData ?? []) as unknown as ConfigLike[]),
    [configsData],
  );
  const notesByRule = React.useMemo(() => {
    const m = new Map<string, RejectionNote[]>();
    for (const r of rules) {
      m.set(
        r.proposedRuleId,
        buildRejectionNotes(
          parseSupportingIds(r.supportingDecisionIds),
          decisionById,
          firmNameById,
        ),
      );
    }
    return m;
  }, [rules, decisionById, firmNameById]);

  const { pending, approved, declined } = React.useMemo(() => groupRules(rules), [rules]);
  // Only the first rule that says "Model: both" gets the glossary tooltip.
  const explainModelId = [...pending, ...approved, ...declined].find(
    (r) => r.ruleModel === "both",
  )?.proposedRuleId;

  const loading = isLoading && rules.length === 0;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Proposed hard-screen rules"
        sub={
          loading
            ? "Loading proposals…"
            : `${pending.length} pending · clustered from your rejections. Approve to auto-screen future firms`
        }
        actions={<ProposeRulesButton propose={propose} />}
      />
      {error !== undefined && error !== null && (
        <Notice className={styles.error}>{String(error)}</Notice>
      )}

      <div className={styles.scroll}>
        {loading && <Skeleton lines={4} />}
        {!isLoading && rules.length === 0 && (
          <EmptyState
            title="Not enough pass history yet"
            body="Proposed hard-screen rules appear once at least four different firms you’ve passed on share a reason. Beacon clusters the reasons and drafts a predicate for you to approve."
          />
        )}
        {rules.length > 0 && (
          <section aria-labelledby="rules-proposed" className={styles.section}>
            <h2 id="rules-proposed" className={styles.heading}>
              Proposed <span className={styles.count}>{pending.length}</span>
            </h2>
            {pending.length === 0 ? (
              <p className={styles.quiet}>No proposals are waiting for a decision.</p>
            ) : (
              <div className={styles.grid}>
                {pending.map((r) => (
                  <ProposedRulePanel
                    key={r.proposedRuleId}
                    rule={r}
                    notes={notesByRule.get(r.proposedRuleId) ?? []}
                    explainModel={r.proposedRuleId === explainModelId}
                    versions={versionsByRule.get(r.proposedRuleId) ?? NO_VERSIONS}
                    firms={firms}
                  />
                ))}
              </div>
            )}
          </section>
        )}
        {approved.length > 0 && (
          <ActiveRules
            rules={approved}
            notesByRule={notesByRule}
            versionsByRule={versionsByRule}
            firms={firms}
            explainModelId={explainModelId}
          />
        )}
        {declined.length > 0 && (
          <DeclinedRules
            rules={declined}
            notesByRule={notesByRule}
            explainModelId={explainModelId}
          />
        )}
      </div>
    </div>
  );
}
