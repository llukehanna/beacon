import type { ObjectOf } from "../../shared/schema.js";
import type { AxisScore } from "../../shared/scoreMirror.js";
import { scoreFirm } from "../../shared/scoring.js";
import {
  ACQUIRED_BY_COMPETITOR,
  DECISION,
  OUTCOMES,
  PASSED,
  isQualifiedOrLater,
  normalizeLifecycle,
} from "../../shared/vocab.js";
import { insertObject, updateObject } from "../db/repo.js";
import { ActionError } from "../errors.js";
import { type FirmObj, iso, logDecision, requireObject } from "./common.js";
import { type ActionContext, defineAction } from "./types.js";

type DriftObj = ObjectOf<"DriftEvent">;

const TIER_RANK: Readonly<Record<string, number>> = { Rejected: 0, C: 1, B: 2, A: 3 };

interface Snapshot {
  tier: string;
  score: number;
  axes: AxisScore[];
}

/** The score version written when the firm reached its terminal state. */
async function terminalSnapshot(ctx: ActionContext, firm: FirmObj): Promise<Snapshot | null> {
  const computedBy =
    normalizeLifecycle(firm.lifecycleState) === PASSED ? "rejectFirm" : "qualifyFirm";
  const rows = await ctx.tx.query<{
    tier: string;
    weightedTotal: number;
    axisScoresJson: string | null;
  }>(
    `SELECT "tier", "weightedTotal", "axisScoresJson" FROM qualification_score
      WHERE "firmId" = $1 AND "computedBy" = $2 ORDER BY "computedAt" DESC LIMIT 1`,
    [firm.$primaryKey, computedBy],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    tier: row.tier,
    score: row.weightedTotal,
    axes: JSON.parse(row.axisScoresJson || "[]") as AxisScore[],
  };
}

export function diffAxes(
  before: readonly AxisScore[],
  after: readonly AxisScore[],
  source: string,
) {
  const prev = new Map(before.map((a) => [a.axis, a]));
  return after
    .filter((a) => {
      const p = prev.get(a.axis);
      return !p || p.score !== a.score || p.band !== a.band;
    })
    .map((a) => ({
      axis: a.axis,
      old: prev.get(a.axis)?.band ?? null,
      new: a.band,
      source,
    }));
}

/**
 * Compare a terminal firm's live score with its snapshot. Qualified firms
 * drift on any tier change; rejected firms only when they improve (the
 * reason for passing may no longer hold). Returns the new DriftEvent id.
 */
export async function computeDriftForFirm(
  ctx: ActionContext,
  firmId: string,
  cause: { source?: string } = {},
): Promise<string | null> {
  const firm = await requireObject(ctx, "Firm", firmId);
  const state = normalizeLifecycle(firm.lifecycleState);
  if (state !== PASSED && !isQualifiedOrLater(state)) {
    return null;
  }
  const snap = await terminalSnapshot(ctx, firm);
  if (!snap) {
    return null;
  }
  const live = scoreFirm(firm);
  if (live.tier === snap.tier) {
    return null;
  }
  if (state === PASSED && (TIER_RANK[live.tier] ?? 0) <= (TIER_RANK[snap.tier] ?? 0)) {
    return null;
  }
  const open = await ctx.tx.query(
    `SELECT 1 FROM drift_event WHERE "firmId" = $1 AND "driftStatus" = 'open' AND "newTier" = $2 LIMIT 1`,
    [firmId, live.tier],
  );
  if (open.length > 0) {
    return null;
  }
  const driftEventId = ctx.newId("drift");
  await insertObject(ctx.tx, "DriftEvent", {
    driftEventId,
    firmId,
    priorTier: snap.tier,
    priorScore: snap.score,
    newTier: live.tier,
    newScore: live.weightedTotal,
    changedAxes: JSON.stringify(diffAxes(snap.axes, live.axisScores, cause.source ?? "rescore")),
    driftReason: state === PASSED ? "pass_reason_invalidated" : "tier_moved",
    driftStatus: "open",
    detectedAt: iso(ctx.now),
  });
  return driftEventId;
}

/**
 * A passed firm the market has since seen acquired by a competitor: "we passed, the market did
 * not". Opens one outcome_diverged drift event per firm (none if it already has one) so the firm
 * resurfaces in Review. Returns the new DriftEvent id.
 */
export async function openOutcomeDivergence(
  ctx: ActionContext,
  firm: FirmObj,
  /** What reported the outcome, when it is not a person: named on the event, as drift names its source. */
  cause: { source?: string } = {},
): Promise<string | null> {
  const existing = await ctx.tx.query(
    `SELECT 1 FROM drift_event WHERE "firmId" = $1 AND "driftReason" = 'outcome_diverged' LIMIT 1`,
    [firm.$primaryKey],
  );
  if (existing.length > 0) {
    return null;
  }
  const snap = await terminalSnapshot(ctx, firm);
  const live = scoreFirm(firm);
  const driftEventId = ctx.newId("drift");
  await insertObject(ctx.tx, "DriftEvent", {
    driftEventId,
    firmId: firm.$primaryKey,
    priorTier: snap?.tier ?? live.tier,
    priorScore: snap?.score ?? live.weightedTotal,
    newTier: snap?.tier ?? live.tier,
    newScore: snap?.score ?? live.weightedTotal,
    changedAxes:
      cause.source === undefined
        ? "[]"
        : JSON.stringify([
            {
              axis: "Market outcome",
              old: null,
              new: "Acquired by a competitor",
              source: cause.source,
            },
          ]),
    driftReason: "outcome_diverged",
    driftStatus: "open",
    detectedAt: iso(ctx.now),
  });
  return driftEventId;
}

export const setFirmOutcome = defineAction("setFirmOutcome", {
  async run(ctx, { firm, outcome, outcomeObservedAt }) {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) {
      throw new ActionError(`Unknown outcome "${outcome}"; expected one of ${OUTCOMES.join(", ")}`);
    }
    // An outcome an analyst records is not a market signal's, even over one a signal recorded.
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      outcome,
      outcomeObservedAt,
      outcomeSource: null,
    });
    const created: string[] = [];
    if (normalizeLifecycle(firm.lifecycleState) === PASSED && outcome === ACQUIRED_BY_COMPETITOR) {
      const driftEventId = await openOutcomeDivergence(ctx, firm);
      if (driftEventId) {
        created.push(driftEventId);
      }
    }
    return { created, modified: [firm.$primaryKey] };
  },
});

async function resolveDrift(
  ctx: ActionContext,
  drift: DriftObj,
  resolution: string,
): Promise<void> {
  if (drift.driftStatus !== "open") {
    throw new ActionError("Drift event is already resolved", 409);
  }
  await updateObject(ctx.tx, "DriftEvent", drift.$primaryKey, {
    driftStatus: "resolved",
    resolution,
    resolvedAt: iso(ctx.now),
    resolvedBy: ctx.user,
  });
}

/**
 * Close every open drift event on a firm that has just been passed: the
 * question the drift raised ("is it still worth pursuing?") is answered.
 * Returns the ids it resolved.
 */
export async function resolveOpenDriftOnPass(
  ctx: ActionContext,
  firmId: string,
): Promise<string[]> {
  const open = await ctx.tx.query<{ driftEventId: string }>(
    `SELECT "driftEventId" FROM drift_event WHERE "firmId" = $1 AND "driftStatus" = 'open'`,
    [firmId],
  );
  for (const { driftEventId } of open) {
    await updateObject(ctx.tx, "DriftEvent", driftEventId, {
      driftStatus: "resolved",
      resolution: "passed",
      resolvedAt: iso(ctx.now),
      resolvedBy: ctx.user,
    });
  }
  return open.map((r) => r.driftEventId);
}

export const reEngageFirm = defineAction("reEngageFirm", {
  async run(ctx, { firm, driftEvent }) {
    if (driftEvent.firmId !== firm.$primaryKey) {
      throw new ActionError("Drift event belongs to a different firm");
    }
    if (normalizeLifecycle(firm.lifecycleState) !== PASSED) {
      throw new ActionError("Only a Passed firm can be re-engaged", 409);
    }
    await resolveDrift(ctx, driftEvent, "re_engaged");
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      lifecycleState: "Screening",
      currentStage: "Screening",
      disposition: null,
      lastReviewed: iso(ctx.now),
    });
    const decisionId = await logDecision(ctx, {
      firmId: firm.$primaryKey,
      decisionType: DECISION.reEngage,
      scoreAtDecision: driftEvent.newScore,
      tierAtDecision: driftEvent.newTier,
    });
    return { created: [decisionId], modified: [firm.$primaryKey, driftEvent.$primaryKey] };
  },
});

export const keepPassed = defineAction("keepPassed", {
  async run(ctx, { driftEvent, rationale }) {
    const why = rationale.trim();
    if (why === "") {
      throw new ActionError("Keeping a firm passed needs a rationale");
    }
    await resolveDrift(ctx, driftEvent, "kept_passed");
    const decisionId = await logDecision(ctx, {
      firmId: driftEvent.firmId,
      decisionType: DECISION.keepPassed,
      rejectionRationale: why,
      scoreAtDecision: driftEvent.newScore,
      tierAtDecision: driftEvent.newTier,
    });
    return { created: [decisionId], modified: [driftEvent.$primaryKey] };
  },
});

export const acknowledgeDrift = defineAction("acknowledgeDrift", {
  async run(ctx, { driftEvent, note }) {
    const firm = await requireObject(ctx, "Firm", driftEvent.firmId ?? "");
    if (normalizeLifecycle(firm.lifecycleState) === PASSED) {
      throw new ActionError(
        "A Passed firm is not in the pipeline; re-engage it or keep it passed",
        409,
      );
    }
    await resolveDrift(ctx, driftEvent, "kept_in_pipeline");
    const why = (note ?? "").trim();
    const decisionId = await logDecision(ctx, {
      firmId: driftEvent.firmId,
      decisionType: DECISION.acknowledgeDrift,
      rejectionRationale: why === "" ? undefined : why,
      scoreAtDecision: driftEvent.newScore,
      tierAtDecision: driftEvent.newTier,
    });
    return { created: [decisionId], modified: [driftEvent.$primaryKey] };
  },
});
