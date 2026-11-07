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
 * Properties that carry a walled mandate's real name: a Mandate's title and intent, and the name of
 * a Search or list, which is built from the title. Filtering or sorting on them would unmask a
 * codename (a row coming back is a confirmed guess), so they are refused for a persona with walled mandates.
 */
const NAME_PROPS: Partial<Record<ObjectTypeName, readonly string[]>> = {
  Mandate: ["title", "intentStatement"],
  Search: ["name"],
  SearchList: ["name"],
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

function assertNamesUnfiltered(access: Access, type: ObjectTypeName, opts: ListOptions): void {
  const names = NAME_PROPS[type] ?? [];
  const used = [...Object.keys(opts.where ?? {}), ...Object.keys(opts.orderBy ?? {})];
  if (walledMandates(access).size > 0 && used.some((k) => names.includes(k))) {
    throw new HttpError("A mandate's name cannot be filtered or sorted without need-to-know", 400);
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
      return json({ data: (await presentAll(db, access, type, [obj]))[0] });
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
    assertNamesUnfiltered(access, type, opts);
    const page = await listObjects(db, type, opts);
    // Looking a firm or a mandate up by its key is opening it; the screens do that as a one-row list.
    const pinned = pinnedKey(type, opts.where);
    if (pinned !== null && page.data.length > 0) {
      await logOpen(db, access, type, pinned);
    }
    return json({ ...page, data: await presentAll(db, access, type, page.data) });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * The persona's view of objects read from the database. A rule that rests on a decision about a
 * hidden firm loses that decision, and its rationale, exactly as the MCP's list_rules does.
 */
async function presentAll<N extends ObjectTypeName>(
  db: Awaited<ReturnType<typeof getDb>>,
  access: Access,
  type: N,
  objects: ObjectOf<N>[],
): Promise<ObjectOf<N>[]> {
  const shown = objects.map((o) => present(access, o));
  if (type !== "ProposedRule" || shown.length === 0) {
    return shown;
  }
  const wall = await ruleWallFor(db, access);
  return (shown as ObjectOf<"ProposedRule">[]).map(
    (r) => presentRule(wall, r).rule,
  ) as unknown as ObjectOf<N>[];
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
