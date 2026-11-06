/**
 * The agent's pipeline for a firm, run in memory and set against the hidden truth: the same
 * `groundFirm` (documents, extraction, grounding) and `reconcileAxis` the agent runs, then the
 * deterministic rubric. Pure: no DB, no network, no clock.
 */
import type { ObjectOf, Props } from "../../shared/schema.js";
import type { Model, Tier } from "../../shared/scoreMirror.js";
import { firmModel, parseAxisValue, scoreFirm } from "../../shared/scoring.js";
import { type AxisDef, ENRICH_AXES, type Provider } from "../../shared/vocab.js";
import { truthFor } from "../enrichment/providers.js";
import { type FindingPlan, reconcileAxis } from "../enrichment/reconcile.js";
import { type FixtureRecord, fixtureToExtractionRows } from "../extraction/fixtures.js";
import { groundFirm } from "../extraction/plan.js";

/** What the agent made of one axis for one firm, beside the truth. */
export interface SlotResult {
  firmId: string;
  model: Model;
  axis: AxisDef;
  /** The hidden true value. */
  truth: string;
  /** Providers whose source record states this axis, before any extraction. */
  stated: Provider[];
  /** Readings that survived grounding, one per provider at most. */
  kept: { provider: Provider; value: string }[];
  /** What the agent records: one abstention, one settled value, or two conflicting positions. */
  plans: FindingPlan[];
}

export interface FirmEvaluation {
  firmId: string;
  model: Model;
  /** The extraction the agent read for this firm: a recorded model, or "rule-based". */
  extractionModel: string;
  slots: SlotResult[];
  /** The tier the rubric gives the firm's true values. */
  truthTier: Tier;
  /** The tier the rubric gives only what the agent settled; abstentions and conflicts stay unknown. */
  agentTier: Tier;
}

/** Stored rows carry a time; none of the measures read it, so it is fixed. */
const FIXTURE_ROW_TIME = new Date("2026-01-01T00:00:00.000Z");

/** A generated firm as the agent reads it. */
export const asFirmObject = (firm: Props<"Firm">): ObjectOf<"Firm"> =>
  ({ ...firm, $apiName: "Firm", $primaryKey: firm.firmId }) as ObjectOf<"Firm">;

/** The firm with each axis set to the given value, as the desk would after accepting it. */
function withValues(
  firm: ObjectOf<"Firm">,
  values: ReadonlyMap<AxisDef, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...firm };
  for (const [axis, value] of values) {
    out[axis.firmField] = parseAxisValue(axis, value);
  }
  return out;
}

export function evaluateFirm(
  firm: ObjectOf<"Firm">,
  rows: readonly ObjectOf<"Extraction">[],
): FirmEvaluation {
  const model = firmModel(firm);
  const { docs, extraction, grounded } = groundFirm(firm, rows);
  const slots: SlotResult[] = [];
  const truths = new Map<AxisDef, string>();
  const settled = new Map<AxisDef, string>();
  for (const axis of ENRICH_AXES.filter((a) => a.models.includes(model))) {
    const kept = grounded.observations.filter((o) => o.axis === axis.axis);
    const plans = reconcileAxis(axis, kept, () => `conflict-${firm.$primaryKey}-${axis.axis}`, {
      groundingRejected: grounded.rejected.some((r) => r.axis === axis.axis),
    });
    const truth = truthFor(firm, axis);
    truths.set(axis, truth);
    if (plans.length === 1 && plans[0].value !== null) {
      settled.set(axis, plans[0].value);
    }
    slots.push({
      firmId: firm.$primaryKey,
      model,
      axis,
      truth,
      stated: docs.filter((d) => d.fields.some((f) => f.axis === axis.axis)).map((d) => d.provider),
      kept: kept.map((o) => ({ provider: o.provider, value: o.value })),
      plans,
    });
  }
  return {
    firmId: firm.$primaryKey,
    model,
    extractionModel: extraction.model,
    slots,
    truthTier: scoreFirm(withValues(firm, truths)).tier,
    agentTier: scoreFirm(withValues(firm, settled)).tier,
  };
}

/** Each firm run through the pipeline against its own stored extraction rows. */
export function evaluateFirms(
  firms: readonly ObjectOf<"Firm">[],
  rows: readonly ObjectOf<"Extraction">[],
): FirmEvaluation[] {
  const byFirm = new Map<string, ObjectOf<"Extraction">[]>();
  for (const row of rows) {
    byFirm.set(row.firmId ?? "", [...(byFirm.get(row.firmId ?? "") ?? []), row]);
  }
  return firms.map((firm) => evaluateFirm(firm, byFirm.get(firm.$primaryKey) ?? []));
}

/**
 * The extraction rows the seed stores for these recordings: current records only, keyed by id so a
 * repeated record for one firm and model replaces the earlier one (as `resetDemo` does).
 */
export function extractionRowsFromFixtures(
  records: readonly FixtureRecord[],
  firms: readonly ObjectOf<"Firm">[],
): ObjectOf<"Extraction">[] {
  const byId = new Map(firms.map((f) => [f.$primaryKey, f]));
  const rows = new Map<string, ObjectOf<"Extraction">>();
  for (const record of records) {
    const firm = byId.get(record.firmId);
    for (const row of firm ? fixtureToExtractionRows(record, firm, FIXTURE_ROW_TIME) : []) {
      rows.set(row.extractionId!, {
        ...row,
        $apiName: "Extraction",
        $primaryKey: row.extractionId!,
      } as ObjectOf<"Extraction">);
    }
  }
  return [...rows.values()];
}
