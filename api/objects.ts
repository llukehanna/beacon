import {
  type Access,
  assertReadable,
  excludeFor,
  isHidden,
  logAccess,
  present,
  presentRule,
  resolveAccess,
  ruleWallFor,
  walledMandates,
} from "../server/access.js";
import { getDb } from "../server/db/client.js";
import { type ListOptions, getObject, listObjects } from "../server/db/repo.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError, jsonParam } from "../server/http.js";
import {
  OBJECT_TYPES,
  type ObjectOf,
  type ObjectTypeName,
  isObjectTypeName,
} from "../shared/schema.js";

/**
 * Properties a filter or sort must not touch, because what comes back is redacted for the persona
 * and a row coming back would confirm a guess about the redacted text.
 *
 * - A walled mandate's real name: a Mandate's title and intent, and the name of a Search or list,
 *   which is built from the title. Refused for a persona with walled mandates.
 * - A rule's rationale, decision ids and mandate scope: a rule that rests on a decision about a
 *   hidden firm loses its rationale and ids, and a scope that names a walled mandate is masked.
 *   Refused for a persona that has hidden firms or walled mandates.
 */
const PROBE_GUARDS: Partial<
  Record<
    ObjectTypeName,
    { props: readonly string[]; applies: (access: Access) => boolean; message: string }
  >
> = {
  Mandate: {
    props: ["title", "intentStatement"],
    applies: (access) => walledMandates(access).size > 0,
    message: "A mandate's name cannot be filtered or sorted without need-to-know",
  },
  Search: {
    props: ["name"],
    applies: (access) => walledMandates(access).size > 0,
    message: "A mandate's name cannot be filtered or sorted without need-to-know",
  },
  SearchList: {
    props: ["name"],
    applies: (access) => walledMandates(access).size > 0,
    message: "A mandate's name cannot be filtered or sorted without need-to-know",
  },
  ProposedRule: {
    props: ["rationaleClusterSummary", "supportingDecisionIds", "mandateScope"],
    applies: (access) => access.hiddenFirmIds.length > 0 || walledMandates(access).size > 0,
    message:
      "A rule's rationale, decision ids and scope cannot be filtered or sorted while firms or mandates are hidden from you",
  },
};

/** The one primary key a `where` pins, when that is all it does: a lookup by id made as a list. */
function pinnedKey(type: ObjectTypeName, where: ListOptions["where"]): string | null {
  const keys = Object.keys(where ?? {});
  if (keys.length !== 1 || keys[0] !== OBJECT_TYPES[type].primaryKey) {
    return null;
  }
  const v = where?.[keys[0]]?.$eq;
  return typeof v === "string" ? v : null;
}

function assertNotProbing(access: Access, type: ObjectTypeName, opts: ListOptions): void {
  const guard = PROBE_GUARDS[type];
  const used = [...Object.keys(opts.where ?? {}), ...Object.keys(opts.orderBy ?? {})];
  if (guard !== undefined && guard.applies(access) && used.some((k) => guard.props.includes(k))) {
    throw new HttpError(guard.message, 400);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "";
    if (!isObjectTypeName(type)) {
      throw new HttpError(`Unknown object type "${type}"`, 404);
    }
    const db = await getDb();
    const access = await resolveAccess(request, db);
    assertReadable(access, type);

    // One object by primary key: the same "not found" for a missing object and one the persona may not see.
    const id = url.searchParams.get("id");
    if (id !== null) {
      const obj = await getObject(db, type, id);
      if (obj === null || isHidden(access, type, obj)) {
        throw new HttpError(`${type} ${id} not found`, 404);
      }
      await logOpen(db, access, type, id);
      return json({ data: (await presentAll(db, access, [obj]))[0] });
    }

    const size = url.searchParams.get("pageSize");
    const pageToken = url.searchParams.get("pageToken") ?? undefined;
    const opts: ListOptions = {
      where: jsonParam(url, "where") as ListOptions["where"],
      orderBy: jsonParam(url, "orderBy") as ListOptions["orderBy"],
      // listObjects caps an over-large pageSize; a non-number is the caller's mistake.
      pageSize: size === null ? undefined : Number(size),
      pageToken,
      exclude: excludeFor(access, type),
    };
    assertNotProbing(access, type, opts);
    const page = await listObjects(db, type, opts);
    // Looking a firm or a mandate up by its key is opening it; the screens do that as a one-row list.
    const pinned = pinnedKey(type, opts.where);
    if (pinned !== null && page.data.length > 0) {
      await logOpen(db, access, type, pinned);
    }
    return json({ ...page, data: await presentAll(db, access, page.data) });
  } catch (e) {
    return jsonError(e);
  }
}

/** True when every object is a rule: a check on the list's type alone would not narrow its elements. */
function areRules(
  objects: readonly ObjectOf<ObjectTypeName>[],
): objects is ObjectOf<"ProposedRule">[] {
  return objects.every((o) => o.$apiName === "ProposedRule");
}

/**
 * The persona's view of objects read from the database. A rule that rests on a decision about a
 * hidden firm loses that decision, and its rationale, exactly as the MCP's list_rules does.
 */
async function presentAll(
  db: Awaited<ReturnType<typeof getDb>>,
  access: Access,
  objects: ObjectOf<ObjectTypeName>[],
): Promise<ObjectOf<ObjectTypeName>[]> {
  const shown = objects.map((o) => present(access, o));
  if (shown.length === 0 || !areRules(shown)) {
    return shown;
  }
  const wall = await ruleWallFor(db, access);
  return shown.map((r) => presentRule(wall, r).rule);
}

async function logOpen(
  db: Awaited<ReturnType<typeof getDb>>,
  access: Access,
  type: ObjectTypeName,
  id: string,
): Promise<void> {
  if (type === "Firm" || type === "Mandate") {
    await logAccess(db, access, type, id);
  }
}
