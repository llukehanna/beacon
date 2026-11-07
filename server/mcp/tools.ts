/**
 * The MCP server's tools: three read-only handlers over the same query and object helpers the API
 * routes use. Each runs for one persona (`Access`): hidden firms are left out of every list and
 * look like a missing id on a lookup, and a walled mandate is named by its codename. No SQL is
 * written here and nothing is built from input; a tool only calls the repository.
 */
import { z } from "zod";
import { bucketOf } from "../../shared/pipelineBuckets.js";
import { summarizePredicate } from "../../shared/rulePredicate.js";
import type { ObjectOf } from "../../shared/schema.js";
import { MAX_POSSIBLE, type Tier, mirrorScore } from "../../shared/scoreMirror.js";
import { LIFECYCLE_STAGES, PASSED } from "../../shared/vocab.js";
import { type FirmView, toScoreInput } from "../../src/desk/firmDesk/deskModel.js";
import {
  type Access,
  assertReadable,
  excludeFor,
  isHidden,
  logAccess,
  present,
  walledMandates,
} from "../access.js";
import type { Queryable } from "../db/client.js";
import { MAX_PAGE_SIZE, getObject, listAll, listObjects } from "../db/repo.js";
import { HttpError } from "../errors.js";
import { firmEvidence } from "./evidence.js";
import {
  JSONRPC_INVALID_PARAMS,
  RpcError,
  type ToolDescriptor,
  type ToolHost,
  type ToolResult,
} from "./rpc.js";

/** The most rows any list tool returns; a larger `limit` is clamped to this. */
export const MAX_RESULTS = 25;
export const DEFAULT_RESULTS = 10;
/** Pages of firms a search will read before it stops and says the scan was partial. */
const MAX_SCAN_PAGES = 3;

type Tool<S extends z.ZodType> = {
  title: string;
  description: string;
  input: S;
  run(q: Queryable, args: z.infer<S>, access: Access): Promise<unknown>;
};

const limitField = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    `How many to return, 1 to ${MAX_RESULTS} (default ${DEFAULT_RESULTS}). A larger number is treated as ${MAX_RESULTS}.`,
  );

/** A caller's `limit` as the number of rows to return. */
export const clampLimit = (limit: number | undefined): number =>
  Math.min(limit ?? DEFAULT_RESULTS, MAX_RESULTS);

const text = (max: number) => z.string().trim().min(1).max(max);

// ─── search_firms ────────────────────────────────────────────────────────

const searchFirmsInput = z
  .object({
    query: text(100).optional().describe("Part of the firm's name (case-insensitive)."),
    sector: text(100).optional().describe("Sector, e.g. Software (case-insensitive, exact)."),
    hqCountry: text(100).optional().describe("Headquarters country (case-insensitive, exact)."),
    firmType: z
      .enum(["CF", "CS"])
      .optional()
      .describe("Scoring model: CF (corporate finance) or CS (capital solutions)."),
    tier: z
      .enum(["A", "B", "C", "Rejected"])
      .optional()
      .describe("The live rubric tier, as the Desk shows it."),
    stage: z
      .enum([...LIFECYCLE_STAGES, PASSED])
      .optional()
      .describe("Pipeline stage."),
    limit: limitField,
  })
  .strict();

interface FirmHit {
  firmId: string;
  firmName: string;
  firmType: string | null;
  sector: string | null;
  hqCountry: string | null;
  employees: number | null;
  stage: string;
  tier: Tier;
  score: number;
  maxScore: number;
}

const same = (a: string | null | undefined, b: string): boolean =>
  (a ?? "").trim().toLowerCase() === b.toLowerCase();

async function searchFirms(
  q: Queryable,
  args: z.infer<typeof searchFirmsInput>,
  access: Access,
): Promise<unknown> {
  assertReadable(access, "Firm");
  const limit = clampLimit(args.limit);
  const needle = args.query?.toLowerCase();

  const hits: FirmHit[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await listObjects(q, "Firm", {
      orderBy: { firmName: "asc" },
      pageSize: MAX_PAGE_SIZE,
      pageToken,
      exclude: excludeFor(access, "Firm"),
    });
    pageToken = page.nextPageToken ?? undefined;
    pages++;
    for (const raw of page.data) {
      const firm = present(access, raw);
      if (
        (needle !== undefined && !(firm.firmName ?? "").toLowerCase().includes(needle)) ||
        (args.sector !== undefined && !same(firm.sector, args.sector)) ||
        (args.hqCountry !== undefined && !same(firm.hqCountry, args.hqCountry)) ||
        (args.firmType !== undefined && !same(firm.firmType, args.firmType))
      ) {
        continue;
      }
      const mirror = mirrorScore(toScoreInput(firm as unknown as FirmView));
      const stage = bucketOf(firm, mirror);
      if (
        (args.tier !== undefined && mirror.tier !== args.tier) ||
        (args.stage && stage !== args.stage)
      ) {
        continue;
      }
      hits.push({
        firmId: firm.$primaryKey,
        firmName: firm.firmName ?? firm.$primaryKey,
        firmType: firm.firmType ?? null,
        sector: firm.sector ?? null,
        hqCountry: firm.hqCountry ?? null,
        employees: firm.employees ?? null,
        stage,
        tier: mirror.tier,
        score: mirror.weightedTotal,
        maxScore: MAX_POSSIBLE,
      });
    }
  } while (pageToken !== undefined && pages < MAX_SCAN_PAGES);

  // Best score first; the name and id break ties so the order is stable.
  hits.sort(
    (a, b) =>
      b.score - a.score || a.firmName.localeCompare(b.firmName) || a.firmId.localeCompare(b.firmId),
  );
  return {
    firms: hits.slice(0, limit),
    returned: Math.min(hits.length, limit),
    totalMatches: hits.length,
    limit,
    // True when more firms exist than were read: the matches above may be an undercount.
    partial: pageToken !== undefined,
  };
}

// ─── get_firm_evidence ───────────────────────────────────────────────────

const firmEvidenceInput = z
  .object({ firmId: text(200).describe("The firm's id, as search_firms returns it.") })
  .strict();

async function getFirmEvidence(
  q: Queryable,
  args: z.infer<typeof firmEvidenceInput>,
  access: Access,
): Promise<unknown> {
  assertReadable(access, "Firm");
  assertReadable(access, "ResearchFinding");
  const firm = await getObject(q, "Firm", args.firmId);
  // The same answer for a missing firm and one this persona may not see.
  if (firm === null || isHidden(access, "Firm", firm)) {
    throw new HttpError(`Firm ${args.firmId} not found`, 404);
  }
  const findings = await listAll(q, "ResearchFinding", {
    where: { firmId: { $eq: firm.$primaryKey } },
    exclude: excludeFor(access, "ResearchFinding"),
  });
  // Opening a firm in detail is viewing it, exactly as the Desk's own reads are logged.
  await logAccess(q, access, "Firm", firm.$primaryKey);
  return firmEvidence(present(access, firm), findings);
}

// ─── list_rules ──────────────────────────────────────────────────────────

const listRulesInput = z
  .object({
    status: z
      .enum(["pending", "approved"])
      .optional()
      .describe("Only rules awaiting a decision, or only approved ones. Both when omitted."),
    limit: limitField,
  })
  .strict();

/** `supportingDecisionIds` is a JSON array or a comma-separated list. */
function supportingIds(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // Not JSON: fall through to the comma-separated form.
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Replaces the real name of every mandate walled from the persona with its codename. */
async function codenameMasker(q: Queryable, access: Access): Promise<(s: string) => string> {
  const walled = walledMandates(access);
  if (walled.size === 0) {
    return (s) => s;
  }
  const swaps: Array<[string, string]> = [];
  for (const m of await listAll(q, "Mandate")) {
    if (!walled.has(m.$primaryKey)) {
      continue;
    }
    const codename = access.mandateCodenames.get(m.$primaryKey) ?? "Restricted mandate";
    for (const real of [m.title, m.intentStatement, m.$primaryKey]) {
      if (real !== undefined && real.trim() !== "") {
        swaps.push([real, codename]);
      }
    }
  }
  // Longest first, so a title is never half-replaced by a shorter name inside it.
  swaps.sort((a, b) => b[0].length - a[0].length);
  return (s) => swaps.reduce((out, [real, codename]) => out.split(real).join(codename), s);
}

async function listRules(
  q: Queryable,
  args: z.infer<typeof listRulesInput>,
  access: Access,
): Promise<unknown> {
  assertReadable(access, "ProposedRule");
  assertReadable(access, "HardScreenConfig");
  const limit = clampLimit(args.limit);
  const wanted = args.status === undefined ? ["pending", "approved"] : [args.status];
  const rules = (await listAll(q, "ProposedRule"))
    .filter((r) => wanted.includes((r.ruleStatus ?? "pending").toLowerCase()))
    .sort(
      (a, b) =>
        (b.proposedAt ?? "").localeCompare(a.proposedAt ?? "") ||
        a.$primaryKey.localeCompare(b.$primaryKey),
    );
  const shown = rules.slice(0, limit);

  // The version of an approved rule that screens: the highest active config.
  const configs = (await listAll(q, "HardScreenConfig")).filter((c) => c.configActive === true);
  const activeOf = (ruleId: string): ObjectOf<"HardScreenConfig"> | undefined =>
    configs
      .filter((c) => c.sourceProposedRuleId === ruleId)
      .sort((a, b) => (b.configVersion ?? 0) - (a.configVersion ?? 0))[0];

  // Decisions on firms this persona cannot see. A rule that rests on one is shown without them:
  // its firm count drops by the hidden firms, and its rationale (which summarises the analysts'
  // notes on those decisions) is withheld rather than guessed at.
  const hiddenDecisions = new Map<string, string>();
  for (const firmId of access.hiddenFirmIds) {
    for (const d of await listAll(q, "ReviewDecision", { where: { firmId: { $eq: firmId } } })) {
      hiddenDecisions.set(d.$primaryKey, firmId);
    }
  }
  const mask = await codenameMasker(q, access);

  return {
    rules: shown.map((r) => {
      const active = activeOf(r.$primaryKey);
      const hiddenFirms = new Set(
        supportingIds(r.supportingDecisionIds).flatMap((id) => hiddenDecisions.get(id) ?? []),
      );
      const predicate =
        (active &&
          summarizePredicate(active.configAxis, active.configOperator, active.configThreshold)) ??
        summarizePredicate(r.predicateAxis, r.ruleOperator, r.ruleThreshold);
      return {
        ruleId: r.$primaryKey,
        status: (r.ruleStatus ?? "pending").toLowerCase(),
        predicate,
        model: r.ruleModel ?? null,
        scope: r.mandateScope === undefined ? null : mask(r.mandateScope),
        rationale:
          hiddenFirms.size > 0 || r.rationaleClusterSummary === undefined
            ? null
            : mask(r.rationaleClusterSummary),
        rationaleWithheld: hiddenFirms.size > 0,
        supportingFirmCount: Math.max(0, (r.supportingFirmCount ?? 0) - hiddenFirms.size),
        // Firms in the queue the rule screens, as counted when it was proposed.
        projectedScreenCount: r.projectedScreenCount ?? null,
        activeVersion: active?.configVersion ?? null,
        proposedAt: r.proposedAt ?? null,
        decidedAt: r.ruleDecidedAt ?? null,
      };
    }),
    returned: shown.length,
    totalMatches: rules.length,
    limit,
  };
}

// ─── The registry ────────────────────────────────────────────────────────

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const TOOLS: Record<string, Tool<z.ZodType>> = {
  search_firms: {
    title: "Search firms",
    description:
      "Find advisory firms in Beacon's synthetic universe by name, sector, headquarters country, " +
      "scoring model, tier or pipeline stage. Returns each firm's live score and tier, best first.",
    input: searchFirmsInput,
    run: searchFirms,
  },
  get_firm_evidence: {
    title: "Get a firm's evidence",
    description:
      "For one firm, every rubric axis with the value Beacon shows, its status (verified, " +
      "proposed, signal, abstained, conflict), and the citation behind it: provider, the source " +
      "sentence quoted and the extraction model. An open conflict lists its two sides.",
    input: firmEvidenceInput,
    run: getFirmEvidence,
  },
  list_rules: {
    title: "List screening rules",
    description:
      "Screening rules proposed from analysts' pass decisions, pending or approved, with the " +
      "predicate in words (e.g. employees < 10), the firms supporting it and its projected impact.",
    input: listRulesInput,
    run: listRules,
  },
};

/** JSON Schema for a tool's arguments, derived from the same schema that validates them. */
function inputSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  // `.int()` adds the safe-integer ceiling as a maximum; it says nothing a client needs.
  const props = (out.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const p of Object.values(props)) {
    if (p.maximum === Number.MAX_SAFE_INTEGER) {
      delete p.maximum;
    }
  }
  return out;
}

export function listTools(): ToolDescriptor[] {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchemaOf(t.input),
    annotations: { ...READ_ONLY },
  }));
}

interface PreparedCall {
  tool: Tool<z.ZodType>;
  args: unknown;
}

/**
 * Checks a call before anything is read: an unknown tool or invalid arguments is a protocol error
 * (-32602), so a bad call costs no query.
 */
export function prepareCall(name: string, args: unknown): PreparedCall {
  if (!Object.prototype.hasOwnProperty.call(TOOLS, name)) {
    throw new RpcError(JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
  }
  const tool = TOOLS[name];
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues
      .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
      .join("; ");
    throw new RpcError(JSONRPC_INVALID_PARAMS, `Invalid arguments for ${name}: ${why}`);
  }
  return { tool, args: parsed.data };
}

/**
 * Runs a prepared call for one persona. A tool that ran and could not answer (a firm that is not
 * there) is a result flagged `isError`, which the model can read and act on.
 */
export async function runCall(
  q: Queryable,
  access: Access,
  { tool, args }: PreparedCall,
): Promise<ToolResult> {
  try {
    const data = await tool.run(q, args, access);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) {
      return { isError: true, content: [{ type: "text", text: e.message }] };
    }
    throw e;
  }
}

/** The tools as the protocol layer sees them. `open` runs only for a call that reads. */
export function toolHost(open: () => Promise<{ q: Queryable; access: Access }>): ToolHost {
  return {
    list: listTools,
    call: async (name, args) => {
      const call = prepareCall(name, args);
      const { q, access } = await open();
      return runCall(q, access, call);
    },
  };
}
