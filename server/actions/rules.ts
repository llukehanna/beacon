import { matchesPredicate, predicateField, ruleKey } from "../../shared/predicate.js";
import type { ObjectOf } from "../../shared/schema.js";
import { DECISION, OPERATORS, PASSED, normalizeLifecycle } from "../../shared/vocab.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer, RejectionRow } from "../clustering/types.js";
import { sortedRows } from "../db/ordering.js";
import { insertObject, listAll, updateObject } from "../db/repo.js";
import { ActionError } from "../errors.js";
import { iso, logDecision } from "./common.js";
import { type ActionContext, defineAction } from "./types.js";

type RuleObj = ObjectOf<"ProposedRule">;

export const MIN_CLUSTER = 4;

const text = (axis?: string, op?: string, threshold?: string): string =>
  `${axis ?? "?"} ${op ?? "?"} ${threshold ?? "?"}`;

async function nextConfigVersion(ctx: ActionContext, ruleId: string): Promise<number> {
  const rows = await ctx.tx.query<{ v: number | null }>(
    `SELECT max("configVersion") AS v FROM hard_screen_config WHERE "sourceProposedRuleId" = $1`,
    [ruleId],
  );
  return (rows[0]?.v ?? 0) + 1;
}

async function deactivateConfigs(ctx: ActionContext, ruleId: string): Promise<void> {
  await ctx.tx.query(
    `UPDATE hard_screen_config SET "configActive" = false WHERE "sourceProposedRuleId" = $1 AND "configActive" = true`,
    [ruleId],
  );
}

async function writeConfig(
  ctx: ActionContext,
  rule: RuleObj,
  operator: string,
  threshold: string,
): Promise<string> {
  const configRuleId = ctx.newId("hsc");
  await insertObject(ctx.tx, "HardScreenConfig", {
    configRuleId,
    configAxis: rule.predicateAxis,
    configOperator: operator,
    configThreshold: threshold,
    configModel: rule.ruleModel ?? "both",
    configVersion: await nextConfigVersion(ctx, rule.$primaryKey),
    configActive: true,
    configAuthor: ctx.user,
    configCreatedAt: iso(ctx.now),
    sourceProposedRuleId: rule.$primaryKey,
  });
  return configRuleId;
}

function requireStatus(rule: RuleObj, allowed: readonly string[], verb: string): void {
  const status = rule.ruleStatus ?? "pending";
  if (!allowed.includes(status)) {
    throw new ActionError(`Rule is ${status}; cannot ${verb} it`, 409);
  }
}

export const approveRule = defineAction<{ proposedRule: RuleObj }>({
  params: { proposedRule: { type: { object: "ProposedRule" } } },
  async run(ctx, { proposedRule: rule }) {
    requireStatus(rule, ["pending"], "approve");
    const configId = await writeConfig(
      ctx,
      rule,
      rule.ruleOperator ?? "",
      rule.ruleThreshold ?? "",
    );
    await updateObject(ctx.tx, "ProposedRule", rule.$primaryKey, {
      ruleStatus: "approved",
      ruleDecidedBy: ctx.user,
      ruleDecidedAt: iso(ctx.now),
    });
    const decisionId = await logDecision(ctx, {
      decisionType: DECISION.activity,
      analystCategorization: `Approved rule: ${text(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold)}`,
    });
    return { created: [configId, decisionId], modified: [rule.$primaryKey] };
  },
});

export const dismissRule = defineAction<{ proposedRule: RuleObj; reason: string }>({
  params: { proposedRule: { type: { object: "ProposedRule" } }, reason: { type: "string" } },
  async run(ctx, { proposedRule: rule, reason }) {
    const why = reason.trim();
    if (why === "") {
      throw new ActionError("Dismissing a rule needs a reason");
    }
    requireStatus(rule, ["pending", "approved"], "dismiss");
    await deactivateConfigs(ctx, rule.$primaryKey);
    await updateObject(ctx.tx, "ProposedRule", rule.$primaryKey, {
      ruleStatus: "dismissed",
      ruleDecidedBy: ctx.user,
      ruleDecidedAt: iso(ctx.now),
    });
    const decisionId = await logDecision(ctx, {
      decisionType: DECISION.activity,
      rejectionRationale: why,
      analystCategorization: `Dismissed rule: ${text(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold)}`,
    });
    return { created: [decisionId], modified: [rule.$primaryKey] };
  },
});

export const unapproveRule = defineAction<{ proposedRule: RuleObj }>({
  params: { proposedRule: { type: { object: "ProposedRule" } } },
  async run(ctx, { proposedRule: rule }) {
    requireStatus(rule, ["approved"], "unapprove");
    await deactivateConfigs(ctx, rule.$primaryKey);
    await updateObject(ctx.tx, "ProposedRule", rule.$primaryKey, {
      ruleStatus: "pending",
      ruleDecidedBy: null,
      ruleDecidedAt: null,
    });
    const decisionId = await logDecision(ctx, {
      decisionType: DECISION.activity,
      analystCategorization: `Unapproved rule: ${text(rule.predicateAxis, rule.ruleOperator, rule.ruleThreshold)}`,
    });
    return { created: [decisionId], modified: [rule.$primaryKey] };
  },
});

export const amendRuleThreshold = defineAction<{
  proposedRule: RuleObj;
  newThreshold: string;
  newOperator?: string;
}>({
  params: {
    proposedRule: { type: { object: "ProposedRule" } },
    newThreshold: { type: "string" },
    newOperator: { type: "string", nullable: true },
  },
  async run(ctx, { proposedRule: rule, newThreshold, newOperator }) {
    requireStatus(rule, ["approved"], "amend");
    const threshold = newThreshold.trim();
    if (threshold === "") {
      throw new ActionError("A new threshold is required");
    }
    const active = (
      await listAll(ctx.tx, "HardScreenConfig", {
        where: { sourceProposedRuleId: { $eq: rule.$primaryKey } },
      })
    ).find((c) => c.configActive);
    const operator = newOperator?.trim() || active?.configOperator || rule.ruleOperator || "";
    if (!(OPERATORS as readonly string[]).includes(operator)) {
      throw new ActionError(`Unsupported operator "${operator}"`);
    }
    await deactivateConfigs(ctx, rule.$primaryKey);
    const configId = await writeConfig(ctx, rule, operator, threshold);
    const decisionId = await logDecision(ctx, {
      decisionType: DECISION.activity,
      analystCategorization: `Amended rule: ${text(rule.predicateAxis, operator, threshold)}`,
    });
    return { created: [configId, decisionId], modified: [rule.$primaryKey] };
  },
});

interface ClusterPrep {
  rows: RejectionRow[];
  /** Null when there were no rejections to cluster. */
  clustered: Awaited<ReturnType<Clusterer>> | null;
}

export const clusterRejections = defineAction<Record<string, never>, ClusterPrep>({
  params: {},
  needsClusterer: true,
  // Reads the rejections and calls the clusterer (possibly Claude) before any transaction opens.
  async prepare(db, _params, ctx) {
    const firms = new Map((await listAll(db, "Firm")).map((f) => [f.$primaryKey, f]));
    // Ordered here, not by the database: its text ordering (the primary-key tie-break) varies by
    // server, and the order is part of the input a recorded clustering reply is matched against.
    const decisions = sortedRows(
      "ReviewDecision",
      await listAll(db, "ReviewDecision", { where: { decisionType: { $eq: DECISION.reject } } }),
      ["decidedAt"],
    );
    const rows: RejectionRow[] = decisions
      .filter((d) => normalizeLifecycle(firms.get(d.firmId ?? "")?.lifecycleState) === PASSED)
      .map((d) => ({
        decisionId: d.$primaryKey,
        firmId: d.firmId!,
        rationale: d.rejectionRationale ?? "",
        firm: firms.get(d.firmId!)!,
      }));
    if (rows.length === 0) {
      return { rows, clustered: null };
    }
    return { rows, clustered: await (ctx.clusterer ?? heuristicClusterer)(rows) };
  },
  // Writes only. The queue and the existing-proposal set are read here, inside
  // the transaction, so a proposal another request landed meanwhile is not duplicated.
  async run(ctx, _params, { rows, clustered }) {
    if (clustered === null) {
      return { created: [], note: "No rejections to learn from yet." };
    }
    const { proposals, source } = clustered;
    const firms = await listAll(ctx.tx, "Firm");
    const byId = new Map(rows.map((r) => [r.decisionId, r]));
    // Never re-propose a rule that already exists in any status (incl. dismissed).
    const seen = new Set(
      (await listAll(ctx.tx, "ProposedRule")).map((r) =>
        ruleKey(r.predicateAxis, r.ruleOperator, r.ruleThreshold, r.ruleModel),
      ),
    );
    const queue = firms.filter((f) => {
      const state = normalizeLifecycle(f.lifecycleState);
      return state === "Discovered" || state === "Screening";
    });

    const created: string[] = [];
    for (const p of proposals) {
      const pred = {
        axis: p.predicateAxis.trim(),
        operator: p.ruleOperator.trim(),
        threshold: p.ruleThreshold.trim(),
        model: p.ruleModel,
      };
      if (
        predicateField(pred.axis) === null ||
        !(OPERATORS as readonly string[]).includes(pred.operator) ||
        pred.threshold === ""
      ) {
        continue;
      }
      // Ground every proposal: support counts only if the firm truly satisfies the predicate.
      const support = [...new Set(p.supportingDecisionIds)].filter((id) => {
        const r = byId.get(id);
        return r !== undefined && matchesPredicate(r.firm, pred);
      });
      // A pattern needs MIN_CLUSTER distinct firms: a firm rejected twice counts once.
      const supportingFirms = new Set(support.map((id) => byId.get(id)!.firmId)).size;
      if (supportingFirms < MIN_CLUSTER) {
        continue;
      }
      const key = ruleKey(pred.axis, pred.operator, pred.threshold, pred.model);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const proposedRuleId = ctx.newId("rule");
      await insertObject(ctx.tx, "ProposedRule", {
        proposedRuleId,
        predicateAxis: pred.axis,
        ruleOperator: pred.operator,
        ruleThreshold: pred.threshold,
        ruleModel: pred.model,
        rationaleClusterSummary: p.summary.trim().slice(0, 280),
        supportingFirmCount: supportingFirms,
        supportingDecisionIds: JSON.stringify(support),
        projectedScreenCount: queue.filter((f) => matchesPredicate(f, pred)).length,
        ruleStatus: "pending",
        proposedAt: iso(ctx.now),
        mandateScope: "All mandates",
      });
      created.push(proposedRuleId);
    }
    const by = source === "claude" ? "Claude" : "the keyword heuristic";
    return {
      created,
      note: `${created.length} rule${created.length === 1 ? "" : "s"} proposed by ${by}.`,
    };
  },
});
