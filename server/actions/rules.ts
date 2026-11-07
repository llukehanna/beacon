import {
  matchesPredicate,
  overlappingPatternKeys,
  predicateField,
  rubricGateFor,
  ruleKey,
  rulePatternKey,
} from "../../shared/predicate.js";
import { describePredicate } from "../../shared/rulePredicate.js";
import type { ObjectOf } from "../../shared/schema.js";
import { DECISION, OPERATORS, PASSED, normalizeLifecycle } from "../../shared/vocab.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer, RejectionRow } from "../clustering/types.js";
import { sortedRows } from "../db/ordering.js";
import { insertObject, insertObjectIfAbsent, listAll, updateObject } from "../db/repo.js";
import { ActionError } from "../errors.js";
import { iso, logDecision } from "./common.js";
import { type ActionContext, defineAction } from "./types.js";

type RuleObj = ObjectOf<"ProposedRule">;

export const MIN_CLUSTER = 4;

/** The key of the advisory lock that serializes proposing runs on one database. */
const PROPOSE_LOCK = 7_183_621;

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

export const approveRule = defineAction("approveRule", {
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

export const dismissRule = defineAction("dismissRule", {
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

export const unapproveRule = defineAction("unapproveRule", {
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

export const amendRuleThreshold = defineAction("amendRuleThreshold", {
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

/** The text a rule key is built from, as SQL: trimmed and lower-cased, as `ruleKey` does. */
const keyPart = (value: string, whenEmpty = ""): string =>
  `lower(btrim(coalesce(${value}, '${whenEmpty}'), E' \\t\\n\\r\\f\\v'))`;

/**
 * The proposed rule whose key equals this predicate's, matched the way the unique index on
 * `proposed_rule` (migration 0003) matches: ignoring case and surrounding spaces, an empty model
 * meaning "both".
 */
async function existingRuleId(
  ctx: ActionContext,
  pred: { axis: string; operator: string; threshold: string; model: string },
): Promise<string> {
  const [row] = await ctx.tx.query<{ id: string }>(
    `SELECT "proposedRuleId" AS id FROM proposed_rule
      WHERE ${keyPart(`"predicateAxis"`)} = ${keyPart("$1::text")}
        AND ${keyPart(`"ruleOperator"`)} = ${keyPart("$2::text")}
        AND ${keyPart(`"ruleThreshold"`)} = ${keyPart("$3::text")}
        AND ${keyPart(`nullif("ruleModel", '')`, "both")} = ${keyPart("nullif($4::text, '')", "both")}`,
    [pred.axis, pred.operator, pred.threshold, pred.model],
  );
  if (row === undefined) {
    // The insert was skipped for another reason (the id is taken): do not let that pass for a duplicate.
    throw new Error("A proposed rule was skipped but no rule has its predicate.");
  }
  return row.id;
}

interface ClusterPrep {
  rows: RejectionRow[];
  /** Null when there were no rejections to cluster. */
  clustered: Awaited<ReturnType<Clusterer>> | null;
}

export const clusterRejections = defineAction<"clusterRejections", ClusterPrep>(
  "clusterRejections",
  {
    needsClusterer: true,
    // Reads the rejections and calls the clusterer (possibly Claude) before any transaction opens.
    async prepare(db, _params, ctx) {
      // A firm hidden from the acting persona is not there: its decisions neither feed the clusterer
      // (and so its rationale cannot reach a rule's summary) nor appear among a rule's supporting ids.
      const hidden = new Set(ctx.hiddenFirmIds);
      const firms = new Map(
        (await listAll(db, "Firm"))
          .filter((f) => !hidden.has(f.$primaryKey))
          .map((f) => [f.$primaryKey, f]),
      );
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
    // Writes only. The queue and the existing-proposal set are read here, inside the transaction, so
    // a rule that was already committed is not proposed again. A rule another request commits after
    // that read is caught by the unique index on the rule key (see the insert below).
    async run(ctx, _params, { rows, clustered }) {
      if (clustered === null) {
        return { created: [], note: "No rejections to learn from yet." };
      }
      // Runs queue here, so each reads the rules the one before it committed. The unique index on
      // the full rule key cannot see a second threshold for a pattern; this lock does.
      await ctx.tx.query(`SELECT pg_advisory_xact_lock($1)`, [PROPOSE_LOCK]);
      const { proposals, source } = clustered;
      const firms = await listAll(ctx.tx, "Firm");
      const byId = new Map(rows.map((r) => [r.decisionId, r]));
      const existing = await listAll(ctx.tx, "ProposedRule");
      // Never re-propose a rule that already exists in any status (incl. dismissed).
      const seen = new Set(
        existing.map((r) => ruleKey(r.predicateAxis, r.ruleOperator, r.ruleThreshold, r.ruleModel)),
      );
      // The patterns a pending or approved rule already covers, whatever its threshold or model,
      // with how each is worded in the note. An approved rule screens with its active config, which
      // an amendment may have moved to another operator, so that pattern counts too.
      const covered = new Map<string, string>();
      const cover = (
        axis?: string,
        op?: string,
        threshold?: string,
        model?: string,
        state?: string,
      ): void => {
        const key = rulePatternKey(axis, op, model);
        if (!covered.has(key)) {
          covered.set(key, `${describePredicate(axis, op, threshold)} (${state})`);
        }
      };
      for (const r of existing) {
        const status = r.ruleStatus ?? "pending";
        if (status === "approved") {
          cover(r.predicateAxis, r.ruleOperator, r.ruleThreshold, r.ruleModel, "active");
        } else if (status === "pending") {
          cover(r.predicateAxis, r.ruleOperator, r.ruleThreshold, r.ruleModel, "pending");
        }
      }
      for (const c of await listAll(ctx.tx, "HardScreenConfig")) {
        if (c.configActive) {
          cover(c.configAxis, c.configOperator, c.configThreshold, c.configModel, "active");
        }
      }
      const hidden = new Set(ctx.hiddenFirmIds);
      const queue = firms.filter((f) => {
        if (hidden.has(f.$primaryKey)) {
          return false;
        }
        const state = normalizeLifecycle(f.lifecycleState);
        return state === "Discovered" || state === "Screening";
      });

      const created: string[] = [];
      const alreadyProposed: string[] = [];
      /** Supported patterns a pending or active rule already covers, as the note names them. */
      const alreadyCovered = new Set<string>();
      /** Supported patterns the rubric already hard-rejects on. */
      const enforced = new Set<string>();
      let answered = 0;
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
        // A rule that repeats one of the rubric's hard-rejects would screen nobody the rubric does
        // not already reject.
        if (rubricGateFor(pred) !== null) {
          enforced.add(describePredicate(pred.axis, pred.operator, pred.threshold));
          continue;
        }
        // One rule per pattern: a second threshold for the same axis and operator is the same
        // reason for passing, so it is not proposed beside the rule that has it.
        const coveredBy = overlappingPatternKeys(pred.axis, pred.operator, pred.model)
          .map((k) => covered.get(k))
          .find((c) => c !== undefined);
        if (coveredBy !== undefined) {
          alreadyCovered.add(coveredBy);
          continue;
        }
        const key = ruleKey(pred.axis, pred.operator, pred.threshold, pred.model);
        if (seen.has(key)) {
          // Proposed before and dismissed: the analyst has already answered it.
          answered += 1;
          continue;
        }
        seen.add(key);
        const proposedRuleId = ctx.newId("rule");
        // `seen` was read at the start of this transaction. A run on another connection can land the
        // same rule after that read; the unique constraint on the predicate turns this insert into a
        // no-op then, and the rule that is there is the one to report.
        const inserted = await insertObjectIfAbsent(ctx.tx, "ProposedRule", {
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
        if (!inserted) {
          alreadyProposed.push(await existingRuleId(ctx, pred));
          continue;
        }
        created.push(proposedRuleId);
        covered.set(
          rulePatternKey(pred.axis, pred.operator, pred.model),
          `${describePredicate(pred.axis, pred.operator, pred.threshold)} (pending)`,
        );
      }
      const by = source === "claude" ? "Claude" : "the keyword heuristic";
      const lost =
        alreadyProposed.length === 0
          ? ""
          : ` A run at the same moment had already proposed: ${alreadyProposed.join(", ")}.`;
      const skipped =
        (alreadyCovered.size === 0
          ? ""
          : ` Already covered by an existing rule: ${[...alreadyCovered].join(", ")}.`) +
        (enforced.size === 0
          ? ""
          : ` Already enforced by the rubric: ${[...enforced].join(", ")}.`);
      if (created.length === 0) {
        const checked = `${rows.length} pass${rows.length === 1 ? "" : "es"} checked`;
        const head =
          alreadyCovered.size + enforced.size + alreadyProposed.length + answered > 0
            ? `No new patterns since the last run (${checked}).`
            : `No pattern has enough support yet (${checked}).`;
        return { created, note: `${head}${skipped}${lost}` };
      }
      return {
        created,
        note: `${created.length} rule${created.length === 1 ? "" : "s"} proposed by ${by}.${skipped}${lost}`,
      };
    },
  },
);
