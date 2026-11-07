/**
 * The information-barrier policy of the demo, as pure functions: who may see which object.
 *
 * The persona is demo-only. It arrives in a request header that anyone can set, so it is a way to
 * show how a wall behaves, not a control. A real deployment derives the persona from the sign-in
 * (SSO claims), never from a header, and enforces the same rules in the data layer. In Foundry the
 * two rules below are Markings: a restricted firm becomes a marking on the object, and need-to-know
 * becomes mandate-level markings or a restricted view.
 *
 *  - Restricted firms (a conflict, a live mandate for a counterparty) are visible to compliance
 *    alone. For everyone else they do not exist: not in a list, a lookup, a count or an export.
 *  - Need-to-know: a mandate is walled when it has access grants and the persona holds none of
 *    them. The persona still sees that the mandate exists, and its firms, but only under its
 *    codename: the title and the free-text intent are replaced.
 *
 * No I/O here. `server/access.ts` loads the restricted set and the grants once per request and
 * applies these functions at the data layer.
 */
import { OBJECT_TYPES, type ObjectTypeName } from "./schema.js";

export const PERSONAS = ["analyst", "deal_lead", "compliance"] as const;
export type Persona = (typeof PERSONAS)[number];

/** Who a request is, when it does not say. */
export const DEFAULT_PERSONA: Persona = "analyst";

/** The request header that carries the demo persona. Unauthenticated: see the note above. */
export const PERSONA_HEADER = "X-Beacon-Persona";

export const PERSONA_LABELS: Readonly<Record<Persona, string>> = {
  analyst: "Analyst",
  deal_lead: "Deal-team lead",
  compliance: "Compliance",
};

export function isPersona(v: unknown): v is Persona {
  return typeof v === "string" && (PERSONAS as readonly string[]).includes(v);
}

/** The persona a header value names; anything missing or unknown is the default analyst. */
export function parsePersona(raw: string | null | undefined): Persona {
  const v = (raw ?? "").trim().toLowerCase();
  return isPersona(v) ? v : DEFAULT_PERSONA;
}

/** One MandateAccess row: the persona may see the mandate in full. */
export interface MandateGrant {
  mandateId: string;
  persona: string;
}

/** The object types only compliance may read: the policy itself and the log of who looked. */
export const COMPLIANCE_ONLY_TYPES: readonly ObjectTypeName[] = [
  "RestrictedFirm",
  "AccessLogEntry",
  "MandateAccess",
];

export const isComplianceOnly = (type: string): boolean =>
  (COMPLIANCE_ONLY_TYPES as readonly string[]).includes(type);

/**
 * The column that ties an object type to a firm, or null when it has none. A type with a firmId
 * property follows its firm's visibility: a finding of a hidden firm is hidden with it. The
 * compliance-only types are excluded: RestrictedFirm.firmId is its own key.
 */
export function firmColumnOf(type: ObjectTypeName): "firmId" | null {
  if (isComplianceOnly(type)) {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(OBJECT_TYPES[type].properties, "firmId")
    ? "firmId"
    : null;
}

/** What an object looks like to the policy: its type, key and (for firm-scoped objects) firm. */
export interface PolicyObject {
  $apiName: string;
  $primaryKey: string;
  firmId?: string | null;
}

export type Visibility = "full" | "codename" | "hidden";

/**
 * Does the persona hold need-to-know on the mandate? Compliance always does. A mandate nobody has
 * been granted (a new one) is not walled; a walled one is open to the personas that hold a grant.
 */
export function hasNeedToKnow(
  persona: Persona,
  mandateId: string,
  grants: readonly MandateGrant[],
): boolean {
  if (persona === "compliance") {
    return true;
  }
  const forMandate = grants.filter((g) => g.mandateId === mandateId);
  return forMandate.length === 0 || forMandate.some((g) => g.persona === persona);
}

/** The mandates the persona sees only by codename. */
export function walledMandateIds(persona: Persona, grants: readonly MandateGrant[]): Set<string> {
  return new Set(
    grants.map((g) => g.mandateId).filter((id) => !hasNeedToKnow(persona, id, grants)),
  );
}

/** The firms the persona must not see: every restricted firm, unless the persona is compliance. */
export function hiddenFirmsFor(
  persona: Persona,
  restricted: Iterable<string>,
): ReadonlySet<string> {
  return persona === "compliance" ? new Set() : new Set(restricted);
}

/**
 * How one object looks to a persona. "hidden" means it does not exist for them; "codename" means
 * it exists but its name is replaced (a walled mandate); "full" is everything.
 */
export function visibilityOf(
  persona: Persona,
  object: PolicyObject,
  grants: readonly MandateGrant[],
  restricted: ReadonlySet<string> | readonly string[],
): Visibility {
  if (persona === "compliance") {
    return "full";
  }
  const type = object.$apiName;
  if (isComplianceOnly(type)) {
    return "hidden";
  }
  const isRestricted = (firmId: string | null | undefined): boolean =>
    firmId != null &&
    (Array.isArray(restricted)
      ? restricted.includes(firmId)
      : (restricted as ReadonlySet<string>).has(firmId));
  if (type === "Firm") {
    return isRestricted(object.$primaryKey) ? "hidden" : "full";
  }
  if (type === "Mandate") {
    return hasNeedToKnow(persona, object.$primaryKey, grants) ? "full" : "codename";
  }
  if (isObjectType(type) && firmColumnOf(type) !== null && isRestricted(object.firmId)) {
    return "hidden";
  }
  return "full";
}

export function canSee(
  persona: Persona,
  object: PolicyObject,
  grants: readonly MandateGrant[],
  restricted: ReadonlySet<string> | readonly string[],
): boolean {
  return visibilityOf(persona, object, grants, restricted) !== "hidden";
}

function isObjectType(name: string): name is ObjectTypeName {
  return Object.prototype.hasOwnProperty.call(OBJECT_TYPES, name);
}

// ─── Codenames and redaction ─────────────────────────────────────────────

const CODENAME_WORDS = [
  "Kestrel",
  "Osprey",
  "Heron",
  "Merlin",
  "Falcon",
  "Harrier",
  "Plover",
  "Curlew",
  "Avocet",
  "Bittern",
  "Dunlin",
  "Godwit",
  "Lapwing",
  "Nuthatch",
  "Pipit",
  "Redwing",
  "Shrike",
  "Siskin",
  "Teal",
  "Wagtail",
  "Whimbrel",
  "Wren",
  "Egret",
  "Fulmar",
  "Gannet",
  "Hobby",
  "Ibis",
  "Jackdaw",
  "Kite",
  "Linnet",
  "Martin",
  "Nightjar",
] as const;

function codenameIndex(mandateId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < mandateId.length; i += 1) {
    h = Math.imul(h ^ mandateId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h % CODENAME_WORDS.length;
}

/** A stable "Project <Bird>" for a mandate id: the same id always gets the same codename. */
export function codenameFor(mandateId: string): string {
  return `Project ${CODENAME_WORDS[codenameIndex(mandateId)]}`;
}

/**
 * The codename for a new mandate that no existing one already holds. It starts where `codenameFor`
 * would and walks on to the next unused word; once every word is taken it numbers them
 * ("Project Kestrel 2"). The same id and the same taken set always give the same name.
 */
export function uniqueCodename(mandateId: string, taken: ReadonlySet<string>): string {
  const start = codenameIndex(mandateId);
  const words = CODENAME_WORDS.length;
  for (let n = 0; ; n += 1) {
    const round = Math.floor(n / words);
    const name = `Project ${CODENAME_WORDS[(start + n) % words]}${round === 0 ? "" : ` ${round + 1}`}`;
    if (!taken.has(name)) {
      return name;
    }
  }
}

export interface MandateLike {
  mandateId?: string | null;
  title?: string | null;
  intentStatement?: string | null;
  codename?: string | null;
}

/**
 * A mandate as the persona may see it. With need-to-know it is returned as it is. Without, its
 * title is the codename and its free-text intent is dropped, so the name shown anywhere (the
 * pages name a mandate by its intent, then its title) is the codename.
 */
export function redactMandate<T extends MandateLike>(
  persona: Persona,
  mandate: T,
  mandateId: string,
  grants: readonly MandateGrant[],
): T {
  if (hasNeedToKnow(persona, mandateId, grants)) {
    return mandate;
  }
  const { intentStatement: _dropped, ...rest } = mandate;
  void _dropped;
  return { ...rest, title: mandate.codename ?? codenameFor(mandateId) } as T;
}

const UNIVERSE_SUFFIX = / — universe$/;

/**
 * A search is named after its mandate ("<title>") and a universe list adds a suffix ("<title> —
 * universe"). For a walled mandate the title part becomes the codename; the suffix stays.
 */
export function redactDerivedName(name: string | null | undefined, codename: string): string {
  const text = name ?? "";
  return UNIVERSE_SUFFIX.test(text) ? `${codename} — universe` : codename;
}

export interface WireLike {
  $apiName: string;
  $primaryKey: string;
  [key: string]: unknown;
}

/**
 * The persona's view of one object that is not hidden: a walled mandate loses its title and intent,
 * and a search or list of a walled mandate loses the title in its name.
 * `codenames` maps a walled mandate to its codename; one missing from it gets the derived name.
 */
export function redactObject<T extends WireLike>(
  persona: Persona,
  object: T,
  grants: readonly MandateGrant[],
  codenames: ReadonlyMap<string, string> = new Map(),
): T {
  if (persona === "compliance") {
    return object;
  }
  if (object.$apiName === "Mandate") {
    return redactMandate(persona, object as MandateLike & T, object.$primaryKey, grants);
  }
  if (object.$apiName === "Search" || object.$apiName === "SearchList") {
    const mandateId = typeof object.mandateId === "string" ? object.mandateId : "";
    if (mandateId !== "" && !hasNeedToKnow(persona, mandateId, grants)) {
      const codename = codenames.get(mandateId) ?? codenameFor(mandateId);
      return { ...object, name: redactDerivedName(object.name as string | undefined, codename) };
    }
  }
  return object;
}

// ─── Rules ───────────────────────────────────────────────────────────────

/** `supportingDecisionIds` is stored as a JSON array or a comma-separated list. */
export function parseDecisionIds(raw: string | null | undefined): string[] {
  if (raw === undefined || raw === null || raw === "") {
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

export interface RuleLike {
  supportingDecisionIds?: string | null;
  rationaleClusterSummary?: string | null;
  supportingFirmCount?: number | null;
  mandateScope?: string | null;
}

/**
 * A screening rule as the persona may see it. A rule rests on pass decisions. When one of them is
 * about a firm the persona cannot see (`hiddenDecisions` maps such a decision to its firm), the
 * rule's firm count drops by those firms, those decision ids are removed, and the rationale (which
 * summarises the analysts' notes on those decisions) is withheld rather than guessed at. A walled
 * mandate named in the scope or the rationale appears by its codename (`mask`). The one rule for
 * every path that returns a rule: the objects route and the MCP's `list_rules`.
 */
export function redactRule<T extends RuleLike>(
  rule: T,
  hiddenDecisions: ReadonlyMap<string, string>,
  mask: (text: string) => string = (s) => s,
): { rule: T; hiddenFirmCount: number } {
  const ids = parseDecisionIds(rule.supportingDecisionIds);
  const hiddenFirms = new Set(ids.flatMap((id) => hiddenDecisions.get(id) ?? []));
  const out: T = { ...rule };
  if (typeof out.mandateScope === "string") {
    out.mandateScope = mask(out.mandateScope);
  }
  if (hiddenFirms.size > 0) {
    delete out.rationaleClusterSummary;
    out.supportingDecisionIds = JSON.stringify(ids.filter((id) => !hiddenDecisions.has(id)));
    out.supportingFirmCount = Math.max(0, (rule.supportingFirmCount ?? 0) - hiddenFirms.size);
  } else if (typeof out.rationaleClusterSummary === "string") {
    out.rationaleClusterSummary = mask(out.rationaleClusterSummary);
  }
  return { rule: out, hiddenFirmCount: hiddenFirms.size };
}
