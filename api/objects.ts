import {
  type Access,
  assertReadable,
  excludeFor,
  isHidden,
  logAccess,
  present,
  resolveAccess,
  walledMandates,
} from "../server/access.js";
import { getDb } from "../server/db/client.js";
import { type ListOptions, getObject, listObjects } from "../server/db/repo.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError, jsonParam } from "../server/http.js";
import { OBJECT_TYPES, type ObjectTypeName, isObjectTypeName } from "../shared/schema.js";

/** Mandate properties that carry the real name: filtering or sorting on them would unmask a codename. */
const MANDATE_NAME_PROPS = ["title", "intentStatement"];

/** The one primary key a `where` pins, when that is all it does: a lookup by id made as a list. */
function pinnedKey(type: ObjectTypeName, where: ListOptions["where"]): string | null {
  const keys = Object.keys(where ?? {});
  if (keys.length !== 1 || keys[0] !== OBJECT_TYPES[type].primaryKey) {
    return null;
  }
  const v = where?.[keys[0]]?.$eq;
  return typeof v === "string" ? v : null;
}

function assertMandateNamesUnfiltered(access: Access, opts: ListOptions): void {
  const used = [...Object.keys(opts.where ?? {}), ...Object.keys(opts.orderBy ?? {})];
  if (walledMandates(access).size > 0 && used.some((k) => MANDATE_NAME_PROPS.includes(k))) {
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
      return json({ data: present(access, obj) });
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
    if (type === "Mandate") {
      assertMandateNamesUnfiltered(access, opts);
    }
    const page = await listObjects(db, type, opts);
    // Looking a firm or a mandate up by its key is opening it; the screens do that as a one-row list.
    const pinned = pinnedKey(type, opts.where);
    if (pinned !== null && page.data.length > 0) {
      await logOpen(db, access, type, pinned);
    }
    return json({ ...page, data: page.data.map((o) => present(access, o)) });
  } catch (e) {
    return jsonError(e);
  }
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
