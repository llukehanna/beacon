import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PREDICATE_AXES } from "../../shared/predicate.js";
import { OPERATORS } from "../../shared/vocab.js";
import { costFromUsage, hasPrice } from "../extraction/pricing.js";
import type { ModelCallInput } from "../operations/record.js";
import type { Clusterer, RejectionRow, RuleProposal } from "./types.js";

export const CLUSTER_MODEL = "claude-opus-5";

const SYSTEM = `You help a corporate development team learn from its own decisions.

You will receive the rejections an analyst has made while screening advisory firms as acquisition targets. Each has the analyst's rationale in their own words and the firm's known facts.

Find recurring reasons that a simple, deterministic screen could have caught before the analyst spent time on the firm. For each one, propose a single predicate on one firm fact, plus the ids of the rejections it explains.

A good proposal:
- is supported by at least four rejections whose rationale AND facts both point to it
- uses a threshold that separates those firms cleanly (round numbers an analyst would write)
- has a one-sentence summary an analyst could read on a card

Propose nothing when there is no clear pattern; an empty list is a good answer. Every proposal is checked against the data and reviewed by a human before it screens anything.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "predicateAxis",
          "ruleOperator",
          "ruleThreshold",
          "ruleModel",
          "summary",
          "supportingDecisionIds",
        ],
        properties: {
          predicateAxis: { type: "string", enum: [...PREDICATE_AXES] },
          ruleOperator: { type: "string", enum: [...OPERATORS] },
          ruleThreshold: { type: "string" },
          ruleModel: { type: "string", enum: ["CF", "CS", "both"] },
          summary: { type: "string" },
          supportingDecisionIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const ProposalsSchema = z.object({
  rules: z.array(
    z.object({
      predicateAxis: z.string(),
      ruleOperator: z.string(),
      ruleThreshold: z.string(),
      ruleModel: z.enum(["CF", "CS", "both"]),
      summary: z.string(),
      supportingDecisionIds: z.array(z.string()),
    }),
  ),
});

const FACTS = [
  "firmType",
  "employees",
  "dealSizeMUsd",
  "dealsPerMdL3y",
  "firmAge",
  "feeGeneratingCount",
  "geoScore",
  "coverageModel",
] as const;

/** One JSON object per line: decision id, rationale, and the facts a predicate can use. */
export function renderRejections(rows: readonly RejectionRow[]): string {
  const lines = rows.map((r) =>
    JSON.stringify({
      decisionId: r.decisionId,
      rationale: r.rationale,
      facts: Object.fromEntries(
        FACTS.filter((k) => r.firm[k] !== undefined).map((k) => [k, r.firm[k]]),
      ),
    }),
  );
  return `Predicate facts map to axes: employees→employees, dealSizeMUsd→deal_size_usd_m, dealsPerMdL3y→deals_per_md_l3y, firmAge→firm_age, feeGeneratingCount→fee_generating_count, geoScore→geo_score, coverageModel→coverage_model.\n\nRejections:\n${lines.join("\n")}`;
}

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * What one live call cost, from the token counts the API reported and the rates in the pricing module.
 * Null when the response carries no usage. A model with no listed price (a fallback the API chose) is
 * priced as the clustering model, so the figure is an estimate in that one case rather than missing.
 */
export function modelCallOf(
  message: { model?: string; usage?: UsageLike | null },
  calledAt: Date,
): ModelCallInput | null {
  const u = message.usage;
  if (!u) {
    return null;
  }
  const model =
    message.model !== undefined && hasPrice(message.model) ? message.model : CLUSTER_MODEL;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return {
    purpose: "clustering",
    model: message.model ?? CLUSTER_MODEL,
    // Cached tokens are input too; the figure shown is every token that went in.
    inputTokens: u.input_tokens + cacheRead + cacheWrite,
    outputTokens: u.output_tokens,
    costUsd: costFromUsage(
      model,
      {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      },
      false,
    ),
    calledAt,
  };
}

interface MessageLike {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

export function parseClusterResponse(message: MessageLike): RuleProposal[] {
  if (message.stop_reason !== "end_turn") {
    throw new Error(`Clustering did not complete (stop_reason: ${message.stop_reason})`);
  }
  const text = message.content
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("");
  return ProposalsSchema.parse(JSON.parse(text)).rules;
}

/**
 * `onCall` hears about every live call that returned, before its reply is parsed: the tokens were
 * spent even when the reply is unusable. It must not throw into the clustering; a failure is logged.
 */
export function createClaudeClusterer(
  client: Anthropic = new Anthropic({ timeout: 30_000, maxRetries: 1 }),
  onCall?: (call: ModelCallInput) => Promise<void>,
): Clusterer {
  return async (rows) => {
    const message = await client.beta.messages.create({
      model: CLUSTER_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: renderRejections(rows) }],
    });
    const call = modelCallOf(message, new Date());
    if (call !== null && onCall !== undefined) {
      try {
        await onCall(call);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Could not record the clustering call.", e);
      }
    }
    return { proposals: parseClusterResponse(message), source: "claude" };
  };
}
