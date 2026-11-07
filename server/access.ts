/**
 * The information barrier at the server: one place that works out who is asking and what they may
 * see, applied where data leaves the database (the objects, links, functions and actions routes)
 * rather than in each screen. Task-level readers (the MCP tools) call the same `resolveAccess`.
 *
 * `resolveAccess(request)` reads the demo persona from the `X-Beacon-Persona` header (default
 * analyst) and, in ONE small query, the restricted firms, the mandate grants and the codenames of
 * the walled mandates. The policy itself is pure and lives in shared/accessPolicy.ts.
 *
 * The persona header is unauthenticated: this is a demonstration of the wall, not a control. A
 * deployment would derive the persona from SSO and keep the same rules in the data layer.
 */
import { randomUUID } from "node:crypto";
import {
  type MandateGrant,
  PERSONA_HEADER,
  type Persona,
  type PolicyObject,
  firmColumnOf,
  hiddenFirmsFor,
  isComplianceOnly,
  parsePersona,
  redactObject,
  visibilityOf,
  walledMandateIds,
} from "../shared/accessPolicy.js";
import type { ObjectOf, ObjectTypeName } from "../shared/schema.js";
import { type Queryable, getDb } from "./db/client.js";
import { HttpError } from "./errors.js";

export interface Access {
  persona: Persona;
  /** Every restricted firm, whoever is asking (compliance sees them; everyone else must not). */
  restrictedFirmIds: ReadonlySet<string>;
  /** Why each restricted firm is restricted. */
  restrictedReasons: ReadonlyMap<string, string>;
  /** Every MandateAccess row (all personas): need-to-know is decided from these. */
  mandateGrants: readonly MandateGrant[];
  /** The codename of each mandate that has grants, for naming the searches that belong to it. */
  mandateCodenames: ReadonlyMap<string, string>;
  /** The firms this persona must not see: `restrictedFirmIds`, or none for compliance. As a list, to bind in SQL. */
  hiddenFirmIds: readonly string[];
}

interface PolicyRow {
  k: string;
  a: string | null;
  b: string | null;
}

/** Everything the policy needs, from three tiny tables, in a single round trip. */
const POLICY_SQL = `
  SELECT 'r' AS k, "firmId" AS a, "reason" AS b FROM restricted_firm
  UNION ALL SELECT 'g', "mandateId", "persona" FROM mandate_access
  UNION ALL SELECT 'm', "mandateId", "codename" FROM mandate
   WHERE "mandateId" IN (SELECT "mandateId" FROM mandate_access)`;

/** The pure half of `resolveAccess`: build an Access from a persona and the policy rows. */
export function buildAccess(persona: Persona, rows: readonly PolicyRow[]): Access {
  const restrictedReasons = new Map<string, string>();
  const grants: MandateGrant[] = [];
  const codenames = new Map<string, string>();
  for (const r of rows) {
    if (r.a === null) {
      continue;
    }
    if (r.k === "r") {
      restrictedReasons.set(r.a, r.b ?? "");
    } else if (r.k === "g" && r.b !== null) {
      grants.push({ mandateId: r.a, persona: r.b });
    } else if (r.k === "m" && r.b !== null) {
      codenames.set(r.a, r.b);
    }
  }
  const restricted = new Set(restrictedReasons.keys());
  return {
    persona,
    restrictedFirmIds: restricted,
    restrictedReasons,
    mandateGrants: grants,
    mandateCodenames: codenames,
    hiddenFirmIds: [...hiddenFirmsFor(persona, restricted)],
  };
}

/** No wall: for server code that is not acting for a persona (the seed, the nightly jobs, tests). */
export const NO_WALL: Access = buildAccess("compliance", []);

export function personaOf(request: Request): Persona {
  return parsePersona(request.headers.get(PERSONA_HEADER));
}

/**
 * Who is asking and what they may see, resolved once for the request. Pass `q` when a database is
 * already in hand; otherwise the request's own is used.
 */
export async function resolveAccess(request: Request, q?: Queryable): Promise<Access> {
  const persona = personaOf(request);
  const rows = await (q ?? (await getDb())).query<PolicyRow>(POLICY_SQL);
  return buildAccess(persona, rows);
}

/** True when the persona may not see this object (a restricted firm, or anything that belongs to one). */
export function isHidden(
  access: Access,
  type: ObjectTypeName,
  obj: { $primaryKey: string; firmId?: string | null },
): boolean {
  const policyObject: PolicyObject = {
    $apiName: type,
    $primaryKey: obj.$primaryKey,
    firmId: obj.firmId,
  };
  return (
    visibilityOf(access.persona, policyObject, access.mandateGrants, access.restrictedFirmIds) ===
    "hidden"
  );
}

/** The policy tables and the log are for compliance alone; anyone else gets a 403. */
export function assertReadable(access: Access, type: ObjectTypeName): void {
  if (isComplianceOnly(type) && access.persona !== "compliance") {
    throw new HttpError("Only the compliance persona can read this", 403);
  }
}

/** The `exclude` option for listing a type: its firm column against the persona's hidden firms. */
export function excludeFor(
  access: Access,
  type: ObjectTypeName,
): { column: string; values: readonly string[] } | undefined {
  const column = firmColumnOf(type);
  return column === null || access.hiddenFirmIds.length === 0
    ? undefined
    : { column, values: access.hiddenFirmIds };
}

/** The persona's view of one object read from the database. */
export function present<N extends ObjectTypeName>(access: Access, obj: ObjectOf<N>): ObjectOf<N> {
  return redactObject(access.persona, obj, access.mandateGrants, access.mandateCodenames);
}

/** The mandates the persona sees by codename. */
export function walledMandates(access: Access): Set<string> {
  return walledMandateIds(access.persona, access.mandateGrants);
}

// ─── The access log ──────────────────────────────────────────────────────

/** Newest rows kept; older ones are trimmed on insert, so a script cannot grow the table. */
export const MAX_ACCESS_LOG = 500;
/** The same persona opening the same object again within this window is one view, not many. */
export const VIEW_DEBOUNCE_SECONDS = 30;

/**
 * Record that a persona opened an object (a firm in detail, a mandate). Best effort: it runs in
 * the request, but a failure is swallowed so that writing the log can never fail the read.
 */
export async function logAccess(
  q: Queryable,
  access: Pick<Access, "persona">,
  objectType: "Firm" | "Mandate",
  objectId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await q.query(
      `INSERT INTO access_log_entry ("entryId", "persona", "objectType", "objectId", "viewedAt")
       SELECT $1::text, $2::text, $3::text, $4::text, $5::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM access_log_entry
           WHERE "persona" = $2 AND "objectType" = $3 AND "objectId" = $4
             AND "viewedAt" > $5::timestamptz - make_interval(secs => $6::int))`,
      [
        `view-${randomUUID()}`,
        access.persona,
        objectType,
        objectId,
        now.toISOString(),
        VIEW_DEBOUNCE_SECONDS,
      ],
    );
    // Only when over the ceiling: keep the newest MAX_ACCESS_LOG rows.
    await q.query(
      `DELETE FROM access_log_entry
        WHERE (SELECT count(*) FROM access_log_entry) > $1::int
          AND "entryId" NOT IN (
            SELECT "entryId" FROM access_log_entry ORDER BY "viewedAt" DESC, "entryId" DESC LIMIT $1::int)`,
      [MAX_ACCESS_LOG],
    );
  } catch (e) {
    // Operational signal for the server log: the read it belongs to has already succeeded.
    // eslint-disable-next-line no-console
    console.warn("Could not write the access log.", e);
  }
}
