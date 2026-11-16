import type { ScoreResult } from "../../shared/rubric/types.js";
import type { ObjectOf, ObjectTypeName, Props } from "../../shared/schema.js";
import { scoreFirm } from "../../shared/scoring.js";
import { getObject, insertObject } from "../db/repo.js";
import { withTraits } from "../db/traits.js";
import { ActionError } from "../errors.js";
import { loadActiveRubric } from "../rubric/load.js";
import type { ActionContext } from "./types.js";

export type FirmObj = ObjectOf<"Firm">;

export const iso = (d: Date): string => d.toISOString();

export async function requireObject<N extends ObjectTypeName>(
  ctx: ActionContext,
  type: N,
  pk: string,
): Promise<ObjectOf<N>> {
  const obj = await getObject(ctx.tx, type, pk);
  if (!obj) {
    throw new ActionError(`${type} ${pk} not found`, 404);
  }
  return obj;
}

/** Append a QualificationScore version for the firm as it stands now. */
export async function snapshotScore(
  ctx: ActionContext,
  firm: FirmObj,
  computedBy: string,
): Promise<ScoreResult> {
  const { rubricId, definition } = await loadActiveRubric(ctx.tx);
  const result = scoreFirm(definition, withTraits(firm));
  await insertObject(ctx.tx, "QualificationScore", {
    scoreId: ctx.newId("qs"),
    firmId: firm.$primaryKey,
    model: result.model,
    weightedTotal: result.weightedTotal,
    maxPossible: result.maxPossible,
    pct: result.pct,
    tier: result.tier,
    confidence: result.confidence,
    axisScoresJson: JSON.stringify(result.axisScores),
    // A rubric version carries its theses, so both stamps name it.
    thesisVersion: rubricId,
    rubricVersion: rubricId,
    computedBy,
    computedAt: iso(ctx.now),
  });
  return result;
}

/** Append a ReviewDecision stamped with the acting user and time. */
export async function logDecision(
  ctx: ActionContext,
  fields: Props<"ReviewDecision">,
): Promise<string> {
  const decisionId = ctx.newId("rd");
  await insertObject(ctx.tx, "ReviewDecision", {
    ...fields,
    decisionId,
    decidedBy: ctx.user,
    decidedAt: iso(ctx.now),
  });
  return decisionId;
}
