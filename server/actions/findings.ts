import { evidenceTraits, traitFor } from "../../shared/rubric/catalog.js";
import { criterionPoints } from "../../shared/rubric/engine.js";
import { thesisOf } from "../../shared/rubric/firm.js";
import {
  TraitValueError,
  checkTraitValue,
  formatTraitValue,
  parseTraitValue,
} from "../../shared/rubric/traitValue.js";
import type { TraitDef, TraitValue } from "../../shared/rubric/types.js";
import type { Props } from "../../shared/schema.js";
import { ANALYST, DECISION, type Provider, normalizeLifecycle } from "../../shared/vocab.js";
import { insertObject, listAll, updateObject } from "../db/repo.js";
import { appendTraitValues, isWholeNumberTrait } from "../db/traits.js";
import { PROVIDERS } from "../enrichment/providers.js";
import { sameValue } from "../enrichment/reconcile.js";
import { ActionError } from "../errors.js";
import { planFirmAxes } from "../extraction/plan.js";
import { loadActiveRubric, loadTraits } from "../rubric/load.js";
import { type FirmObj, iso, logDecision, requireObject, snapshotScore } from "./common.js";
import { computeDriftForFirm } from "./drift.js";
import { type ActionContext, defineAction } from "./types.js";

const moveToScreening = (firm: FirmObj): Props<"Firm"> =>
  normalizeLifecycle(firm.lifecycleState) === "Discovered"
    ? { lifecycleState: "Screening", currentStage: "Screening" }
    : {};

/** The points a lone value earns on its criterion under the active rubric (null when unscored). */
async function pointsFor(
  ctx: ActionContext,
  firm: FirmObj,
  axis: TraitDef,
  value: string,
): Promise<number | null> {
  const { definition } = await loadActiveRubric(ctx.tx);
  return criterionPoints(definition, thesisOf(firm), axis.traitKey, parseTraitValue(axis, value));
}

/** The evidence trait a finding's axis names, or null when the catalog has none. */
async function evidenceTrait(ctx: ActionContext, name: string): Promise<TraitDef | null> {
  return traitFor(evidenceTraits(await loadTraits(ctx.tx)), name) ?? null;
}

async function insertAnalystFinding(
  ctx: ActionContext,
  firm: FirmObj,
  axis: TraitDef,
  value: string,
  excerpt: string,
  normalizedScore?: number | null,
): Promise<string> {
  const findingId = ctx.newId("rf");
  await insertObject(ctx.tx, "ResearchFinding", {
    findingId,
    firmId: firm.$primaryKey,
    axis: axis.traitKey,
    value,
    provider: ANALYST,
    sourceType: "analyst",
    sourceExcerpt: excerpt,
    confidence: 1,
    confidenceTier: "high",
    // Analyst-authored: verified for the axis, but not "agent agreement".
    findingStatus: "verified",
    verifiedByHuman: false,
    verifiedBy: ctx.user,
    verifiedAt: iso(ctx.now),
    normalizedScore: normalizedScore ?? (await pointsFor(ctx, firm, axis, value)),
    retrievedAt: iso(ctx.now),
  });
  return findingId;
}

/** "dealdb+filings" as "Deal DB + Filings"; anything else (the agent, an analyst) as written. */
const providerLabels = (provider: string): string =>
  provider
    .split("+")
    .map((p) => PROVIDERS[p as Provider]?.label ?? p)
    .join(" + ");

export const runAgentEnrichment = defineAction("runAgentEnrichment", {
  async run(ctx, { firm }) {
    const existing = await listAll(ctx.tx, "ResearchFinding", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    const stored = await listAll(ctx.tx, "Extraction", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    const created: string[] = [];
    const settled = (axis: TraitDef) =>
      existing.some((f) => f.axis === axis.traitKey && f.findingStatus === "verified"); // settled by a human
    for (const { axis, plans } of planFirmAxes(
      firm,
      stored,
      () => ctx.newId("cg"),
      (axis) => !settled(axis),
    )) {
      for (const stale of existing.filter(
        (f) =>
          f.axis === axis.traitKey &&
          (f.findingStatus === "proposed" || f.findingStatus === "abstained"),
      )) {
        await updateObject(ctx.tx, "ResearchFinding", stale.$primaryKey, {
          findingStatus: "superseded",
        });
      }
      for (const plan of plans) {
        const findingId = ctx.newId("rf");
        await insertObject(ctx.tx, "ResearchFinding", {
          findingId,
          firmId: firm.$primaryKey,
          ...plan,
          normalizedScore:
            plan.value === null ? null : await pointsFor(ctx, firm, axis, plan.value),
          verifiedByHuman: false,
          retrievedAt: iso(ctx.now),
        });
        created.push(findingId);
      }
    }
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      enrichedBy: "agent",
      enrichedAt: iso(ctx.now),
      ...moveToScreening(firm),
    });
    return { created, modified: [firm.$primaryKey] };
  },
});

export const verifyFinding = defineAction("verifyFinding", {
  async run(ctx, { finding, overrideValue, overrideNormalizedScore }) {
    const status = finding.findingStatus ?? "proposed";
    if (status !== "proposed" && status !== "abstained") {
      throw new ActionError(
        `Finding is ${status}; only proposed or abstained findings can be verified`,
        409,
      );
    }
    const axis = await evidenceTrait(ctx, finding.axis ?? "");
    if (!axis) {
      throw new ActionError(`Unknown axis "${finding.axis ?? ""}"`);
    }
    const newValue = overrideValue?.trim() ?? "";
    if (status === "abstained" && newValue === "") {
      throw new ActionError("An abstained finding needs a value from the analyst");
    }
    const valueChanged =
      newValue !== "" && !(finding.value !== undefined && sameValue(axis, newValue, finding.value));
    const scoreChanged =
      overrideNormalizedScore !== undefined && overrideNormalizedScore !== finding.normalizedScore;
    const stamp = { verifiedBy: ctx.user, verifiedAt: iso(ctx.now) };

    if (!valueChanged && !scoreChanged) {
      await updateObject(ctx.tx, "ResearchFinding", finding.$primaryKey, {
        findingStatus: "verified",
        verifiedByHuman: true,
        ...stamp,
      });
      return { modified: [finding.$primaryKey] };
    }
    // Override: the agent's value is recorded as wrong (an abstention stays an
    // abstention), and the analyst's value becomes the verified record.
    if (status === "proposed") {
      await updateObject(ctx.tx, "ResearchFinding", finding.$primaryKey, {
        findingStatus: "rejected",
        ...stamp,
      });
    }
    const firm = await requireObject(ctx, "Firm", finding.firmId ?? "");
    const value = newValue !== "" ? newValue : (finding.value ?? "");
    const findingId = await insertAnalystFinding(
      ctx,
      firm,
      axis,
      value,
      finding.value === undefined
        ? `Analyst entered ${value}, where the agent recorded no value.`
        : `Analyst entered ${value}, replacing the ${providerLabels(finding.provider ?? "agent")} value ${finding.value}.`,
      overrideNormalizedScore,
    );
    return { created: [findingId], modified: [finding.$primaryKey] };
  },
});

export const resolveConflict = defineAction("resolveConflict", {
  async run(ctx, { chosenFinding: chosen, rejectedFinding: rejected, chosenValue }) {
    if (chosen.$primaryKey === rejected.$primaryKey) {
      throw new ActionError("Pick two different findings");
    }
    if (!chosen.conflictGroupId || chosen.conflictGroupId !== rejected.conflictGroupId) {
      throw new ActionError("Findings are not in the same conflict group");
    }
    if (chosenValue.trim() !== (chosen.value ?? "").trim()) {
      throw new ActionError("chosenValue must match the chosen finding's value");
    }
    for (const f of [chosen, rejected]) {
      if (f.findingStatus !== "proposed") {
        throw new ActionError(`Finding ${f.$primaryKey} is already ${f.findingStatus}`, 409);
      }
    }
    const stamp = { verifiedBy: ctx.user, verifiedAt: iso(ctx.now) };
    await updateObject(ctx.tx, "ResearchFinding", chosen.$primaryKey, {
      findingStatus: "verified",
      verifiedByHuman: true,
      ...stamp,
    });
    await updateObject(ctx.tx, "ResearchFinding", rejected.$primaryKey, {
      findingStatus: "rejected",
      ...stamp,
    });
    const decisionId = await logDecision(ctx, {
      firmId: chosen.firmId,
      decisionType: DECISION.adjust,
      analystCategorization: `Resolved ${chosen.axis} conflict: ${chosen.provider} over ${rejected.provider}`,
    });
    return { created: [decisionId], modified: [chosen.$primaryKey, rejected.$primaryKey] };
  },
});

function parseKeyList(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return new Set(v.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    // fall through to comma-separated
  }
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Parse and check enrichFirm's `traitValues` against the stored catalog. */
async function traitValuesParam(
  ctx: ActionContext,
  raw: string | undefined,
): Promise<Record<string, TraitValue | null>> {
  if (raw === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ActionError("traitValues must be a JSON object of trait key to value");
  }
  const catalog = new Map((await loadTraits(ctx.tx)).map((t) => [t.traitKey, t]));
  const out: Record<string, TraitValue | null> = {};
  for (const [key, v] of Object.entries(parsed)) {
    const trait = catalog.get(key);
    if (!trait) {
      throw new ActionError(`Unknown trait "${key}"`);
    }
    let value: TraitValue | null;
    try {
      value = checkTraitValue(trait, v);
    } catch (e) {
      throw new ActionError(e instanceof TraitValueError ? e.message : String(e));
    }
    out[key] = value === null ? null : storable(trait, value);
  }
  return out;
}

/**
 * A checked value as its column stores it, refused by trait name when it cannot be: a fraction
 * for a whole-number trait, or a label outside a category trait's vocabulary (matched trimmed and
 * case-insensitively, then stored as the catalog spells it).
 */
function storable(trait: TraitDef, value: TraitValue): TraitValue {
  if (typeof value === "number" && isWholeNumberTrait(trait.traitKey) && !Number.isInteger(value)) {
    throw new ActionError(`${trait.traitKey} must be a whole number, got ${value}`);
  }
  if (trait.kind === "category" && typeof value === "string" && trait.options !== null) {
    const want = value.trim().toLowerCase();
    const label = trait.options.find((o) => o.toLowerCase() === want);
    if (label === undefined) {
      throw new ActionError(`${trait.traitKey} must be one of: ${trait.options.join(", ")}`);
    }
    return label;
  }
  return value;
}

export const enrichFirm = defineAction("enrichFirm", {
  async run(ctx, p) {
    const { firm } = p;
    const incoming = await traitValuesParam(ctx, p.traitValues);
    if (Object.keys(incoming).length === 0) {
      throw new ActionError("Nothing to enrich; pass at least one trait value");
    }
    const catalog = await loadTraits(ctx.tx);
    const written = evidenceTraits(catalog).filter((t) => incoming[t.traitKey] !== undefined);

    // Each value cites the finding behind it: an open or verified finding with the same value, or
    // the analyst finding recorded for a manual value nothing backs.
    const manual = parseKeyList(p.fieldsEnteredManually);
    const existing = await listAll(ctx.tx, "ResearchFinding", {
      where: { firmId: { $eq: firm.$primaryKey } },
    });
    const created: string[] = [];
    const sources: Record<string, string | undefined> = {};
    for (const axis of written.filter((a) => incoming[a.traitKey] !== null)) {
      const value = formatTraitValue(incoming[axis.traitKey]!);
      const backing = existing
        .filter(
          (f) =>
            f.axis === axis.traitKey &&
            f.value !== undefined &&
            (f.findingStatus === "proposed" || f.findingStatus === "verified") &&
            sameValue(axis, f.value, value),
        )
        .sort(
          (a, b) => Number(b.findingStatus === "verified") - Number(a.findingStatus === "verified"),
        )[0];
      if (backing) {
        sources[axis.traitKey] = backing.$primaryKey;
      } else if (manual.has(axis.traitKey)) {
        // Analyst evidence only for manual values no existing finding backs; accepted agent
        // findings are verified separately by the desk's flush.
        const id = await insertAnalystFinding(
          ctx,
          firm,
          axis,
          value,
          "Entered by the analyst on the enrichment desk.",
        );
        created.push(id);
        sources[axis.traitKey] = id;
      }
    }
    await appendTraitValues(ctx.tx, firm.$primaryKey, incoming, {
      setBy: ctx.user,
      setAt: iso(ctx.now),
      sources,
    });
    await updateObject(ctx.tx, "Firm", firm.$primaryKey, {
      enrichedBy: ctx.user,
      enrichedAt: iso(ctx.now),
      lastReviewed: iso(ctx.now),
      ...moveToScreening(firm),
    });
    const fresh = await requireObject(ctx, "Firm", firm.$primaryKey);

    const result = await snapshotScore(ctx, fresh, "enrichFirm");
    created.push(
      await logDecision(ctx, {
        firmId: firm.$primaryKey,
        decisionType: DECISION.enrich,
        fieldsEnteredManually: p.fieldsEnteredManually ?? "[]",
        agentValuesOverridden: p.agentValuesOverridden,
        scoreAtDecision: result.weightedTotal,
        tierAtDecision: result.tier,
      }),
    );
    const driftId = await computeDriftForFirm(ctx, firm.$primaryKey, {
      source: manual.size > 0 ? ANALYST : "agent",
    });
    if (driftId) {
      created.push(driftId);
    }
    return { created, modified: [firm.$primaryKey] };
  },
});
