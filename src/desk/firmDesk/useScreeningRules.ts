import React from "react";
import { useOsdkObjects } from "@/data/hooks";
import { HardScreenConfig, ProposedRule } from "@/data/ontology";
import { type ScreeningRule, toScreeningRules } from "../activeScreening";
import { type ActiveConfigRule } from "../queue";

/**
 * The approved rules that screen firms out, as the Desk reads them. `rankingRules` is the one
 * list the queue ranks on and a firm's hard-screen verdict reads, so every screen that shows a
 * verdict (the Desk header, the tear sheet) takes it from here and cannot disagree.
 */
export function useScreeningRules(): {
  screeningRules: ScreeningRule[];
  rankingRules: ActiveConfigRule[];
  configLoading: boolean;
  proposedRulesLoading: boolean;
} {
  // Active approved HardScreenConfig rows drive the shared hard-screen
  // verdict for both the queue and the header/badge — see queue.ts
  // computeHardScreen. Filter to configActive === true so pending or
  // dismissed proposals cannot silently screen firms.
  const { data: configData, isLoading: configLoading } = useOsdkObjects(HardScreenConfig, {
    autoFetchMore: true,
  });
  const activeConfigs = React.useMemo<ActiveConfigRule[]>(() => {
    return (
      (
        (configData ?? []) as unknown as Array<{
          configRuleId: string;
          configActive?: boolean;
          configAxis?: string;
          configOperator?: string;
          configThreshold?: string;
          configModel?: string;
        }>
      )
        .filter((r) => r.configActive === true)
        .map((r) => ({
          ruleId: r.configRuleId,
          axis: r.configAxis ?? "",
          operator: r.configOperator ?? "",
          threshold: r.configThreshold ?? "",
          model: r.configModel ?? "both",
        }))
        // Skip malformed rows — a rule with no axis / no operator / no
        // threshold can't be evaluated. Better to omit than to false-positive.
        .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "")
    );
  }, [configData]);

  // The approved rules /rules renders. The desk screens on these directly
  // rather than waiting for HardScreenConfig rows to exist — that dependency
  // is what let the header read "711 of 711" while /rules showed an approved
  // rule claiming 160 firms. Config rows still win where present, because an
  // amended threshold is what the analyst sees as the effective predicate.
  const { data: proposedRuleData, isLoading: proposedRulesLoading } = useOsdkObjects(ProposedRule, {
    autoFetchMore: true,
  });
  const screeningRules = React.useMemo<ScreeningRule[]>(
    () =>
      toScreeningRules(
        (proposedRuleData ?? []) as unknown as Parameters<typeof toScreeningRules>[0],
        (configData ?? []) as unknown as Parameters<typeof toScreeningRules>[1],
      ),
    [proposedRuleData, configData],
  );

  // One rule list drives ranking and the view filter. ScreeningRule is a
  // superset of ActiveConfigRule, so the queue's shared hard-screen verdict
  // reads the same approved rules the sidebar partitions on.
  const rankingRules = React.useMemo<ActiveConfigRule[]>(() => {
    const seen = new Set(screeningRules.map((r) => r.ruleId));
    return [...screeningRules, ...activeConfigs.filter((c) => !seen.has(c.ruleId))];
  }, [screeningRules, activeConfigs]);

  return { screeningRules, rankingRules, configLoading, proposedRulesLoading };
}
