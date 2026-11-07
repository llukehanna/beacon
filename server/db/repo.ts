import { firmColumnOf } from "../../shared/accessPolicy.js";
import {
  OBJECT_TYPES,
  type ObjectOf,
  type ObjectTypeName,
  type Props,
  findLink,
} from "../../shared/schema.js";
import { HttpError } from "../errors.js";
import type { Queryable } from "./client.js";

export interface ListOptions {
  where?: Record<string, { $eq: unknown }>;
  orderBy?: Record<string, "asc" | "desc">;
  /** Rows per page: defaults to and is capped at MAX_PAGE_SIZE. */
  pageSize?: number;
  /** The previous page's nextPageToken. */
  pageToken?: string;
  /** Rows whose `column` holds one of `values` are left out (the access policy's hidden firms). */
  exclude?: { column: string; values: readonly string[] };
}

/** `col` is null or none of the values bound at `$n`; true for an empty list. */
const notIn = (column: string, n: number): string =>
  `(${col(column)} IS NULL OR ${col(column)} <> ALL($${n}::text[]))`;

// Column names only ever come from the schema (checked below), never from input.
const col = (name: string): string => `"${name}"`;

function assertProps(type: ObjectTypeName, keys: readonly string[]): void {
  const props = OBJECT_TYPES[type].properties as Readonly<Record<string, unknown>>;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) {
      throw new HttpError(`Unknown property "${k}" on ${type}`, 400);
    }
  }
}

/** DB row → wire object: nulls dropped, Dates as ISO strings, identity fields added. */
export function toWire<N extends ObjectTypeName>(
  type: N,
  row: Record<string, unknown>,
): ObjectOf<N> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      continue;
    }
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  out.$apiName = type;
  out.$primaryKey = String(row[OBJECT_TYPES[type].primaryKey]);
  return out as ObjectOf<N>;
}

function insertParts<N extends ObjectTypeName>(
  type: N,
  obj: Props<N>,
): { sql: string; values: unknown[] } {
  const def = OBJECT_TYPES[type];
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  assertProps(
    type,
    entries.map(([k]) => k),
  );
  const pk = entries.find(([k]) => k === def.primaryKey)?.[1];
  if (typeof pk !== "string" || pk === "") {
    throw new Error(`${type} insert is missing ${def.primaryKey}`);
  }
  return {
    sql: `INSERT INTO ${def.table} (${entries.map(([k]) => col(k)).join(", ")}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(", ")})`,
    values: entries.map(([, v]) => v),
  };
}

export async function insertObject<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  obj: Props<N>,
): Promise<void> {
  const { sql, values } = insertParts(type, obj);
  await q.query(sql, values);
}

/**
 * Insert one row unless it collides with an existing one: its key, or a unique constraint such as
 * the one proposed_rule has on its predicate. Returns false when it was left out. Any other
 * constraint violation still fails.
 */
export async function insertObjectIfAbsent<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  obj: Props<N>,
): Promise<boolean> {
  const { sql, values } = insertParts(type, obj);
  const rows = await q.query(
    `${sql} ON CONFLICT DO NOTHING RETURNING ${col(OBJECT_TYPES[type].primaryKey)}`,
    values,
  );
  return rows.length > 0;
}

/** Insert many rows in one statement (one round trip); the rows' own keys pick the columns. */
export async function insertObjects<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  objs: readonly Props<N>[],
): Promise<void> {
  if (objs.length === 0) {
    return;
  }
  const def = OBJECT_TYPES[type];
  const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))];
  assertProps(type, keys);
  for (const o of objs) {
    const pk = (o as Record<string, unknown>)[def.primaryKey];
    if (typeof pk !== "string" || pk === "") {
      throw new Error(`${type} insert is missing ${def.primaryKey}`);
    }
  }
  const cols = keys.map(col).join(", ");
  await q.query(
    `INSERT INTO ${def.table} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${def.table}, $1::json)`,
    [JSON.stringify(objs)],
  );
}

export async function updateObject<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  pk: string,
  patch: Props<N>,
): Promise<void> {
  const def = OBJECT_TYPES[type];
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k !== def.primaryKey);
  assertProps(
    type,
    entries.map(([k]) => k),
  );
  if (entries.length === 0) {
    return;
  }
  const rows = await q.query(
    `UPDATE ${def.table} SET ${entries.map(([k], i) => `${col(k)} = $${i + 1}`).join(", ")} WHERE ${col(def.primaryKey)} = $${entries.length + 1} RETURNING ${col(def.primaryKey)}`,
    [...entries.map(([, v]) => v), pk],
  );
  if (rows.length === 0) {
    throw new HttpError(`${type} ${pk} not found`, 404);
  }
}

export async function getObject<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  pk: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ObjectOf<N> | null> {
  const def = OBJECT_TYPES[type];
  const lock = opts.forUpdate ? " FOR UPDATE" : "";
  const rows = await q.query(
    `SELECT * FROM ${def.table} WHERE ${col(def.primaryKey)} = $1${lock}`,
    [pk],
  );
  return rows[0] ? toWire(type, rows[0]) : null;
}

export const MAX_PAGE_SIZE = 1000;

export interface Page<N extends ObjectTypeName> {
  data: ObjectOf<N>[];
  /** Pass back as `pageToken` for the next page; null when this page was the last. */
  nextPageToken: string | null;
}

type SortValue = string | number | boolean | null;

const badToken = (): HttpError => new HttpError("Invalid pageToken", 400);

/** Opaque cursor: base64url of the last row's sort key values (the orderBy columns, then the primary key). */
function encodeToken(key: readonly SortValue[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(key));
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeToken(token: string, width: number): SortValue[] {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw badToken();
  }
  let key: unknown;
  try {
    const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    key = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    throw badToken();
  }
  const ok =
    Array.isArray(key) &&
    key.length === width &&
    key.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)) &&
    typeof key[width - 1] === "string";
  if (!ok) {
    throw badToken();
  }
  return key as SortValue[];
}

/**
 * Rows strictly after `key` in the order (col dir NULLS LAST, ..., pk ASC):
 * for some position i, every earlier column ties with the cursor and column i
 * comes later. `params` receives the cursor values; `first` is the next $n.
 */
function afterCursorSql(
  sortCols: readonly { column: string; dir: "ASC" | "DESC" }[],
  key: readonly SortValue[],
  params: unknown[],
): string {
  const first = params.length + 1;
  params.push(...key);
  const ref = (i: number): string => `$${first + i}`;
  const branches = sortCols.flatMap(({ column, dir }, i) => {
    if (key[i] === null) {
      return []; // NULLS LAST: nothing sorts after a null; ties fall through to later columns.
    }
    const ties = sortCols.slice(0, i).map((c, j) => `${c.column} IS NOT DISTINCT FROM ${ref(j)}`);
    const later = `${column} ${dir === "ASC" ? ">" : "<"} ${ref(i)}`;
    const after = i === sortCols.length - 1 ? later : `(${later} OR ${column} IS NULL)`;
    return [`(${[...ties, after].join(" AND ")})`];
  });
  return branches.length ? `(${branches.join(" OR ")})` : "FALSE";
}

export async function listObjects<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  opts: ListOptions = {},
): Promise<Page<N>> {
  const def = OBJECT_TYPES[type];
  const where = Object.entries(opts.where ?? {});
  assertProps(
    type,
    where.map(([k]) => k),
  );
  for (const [k, cond] of where) {
    if (typeof cond !== "object" || cond === null || Object.keys(cond).join() !== "$eq") {
      throw new HttpError(`Only {"$eq": value} filters are supported (property "${k}")`, 400);
    }
  }
  const order = Object.entries(opts.orderBy ?? {});
  assertProps(
    type,
    order.map(([k]) => k),
  );
  for (const [k, dir] of order) {
    if (dir !== "asc" && dir !== "desc") {
      throw new HttpError(`Sort direction for "${k}" must be asc or desc`, 400);
    }
  }
  const requested = opts.pageSize ?? MAX_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new HttpError("pageSize must be a positive integer", 400);
  }
  const pageSize = Math.min(requested, MAX_PAGE_SIZE);

  const sortCols = [
    ...order.map(([k, d]) => ({ name: k, column: col(k), dir: d.toUpperCase() as "ASC" | "DESC" })),
    { name: def.primaryKey, column: col(def.primaryKey), dir: "ASC" as const },
  ];
  const params: unknown[] = where.map(([, c]) => c.$eq);
  const conditions = where.map(([k], i) => `${col(k)} = $${i + 1}`);
  if (opts.exclude !== undefined && opts.exclude.values.length > 0) {
    assertProps(type, [opts.exclude.column]);
    params.push([...opts.exclude.values]);
    conditions.push(notIn(opts.exclude.column, params.length));
  }
  if (opts.pageToken !== undefined) {
    conditions.push(afterCursorSql(sortCols, decodeToken(opts.pageToken, sortCols.length), params));
  }
  const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const orderSql = sortCols.map((c, i) =>
    i < order.length ? `${c.column} ${c.dir} NULLS LAST` : `${c.column} ASC`,
  );
  params.push(pageSize);
  const rows = await q.query(
    `SELECT * FROM ${def.table}${whereSql} ORDER BY ${orderSql.join(", ")} LIMIT $${params.length}`,
    params,
  );
  const last = rows[rows.length - 1];
  const nextPageToken =
    rows.length === pageSize && last
      ? encodeToken(
          sortCols.map(({ name }) => {
            const v = last[name];
            return (v instanceof Date ? v.toISOString() : (v ?? null)) as SortValue;
          }),
        )
      : null;
  return { data: rows.map((r) => toWire(type, r)), nextPageToken };
}

/** Every matching object, following pages to the end. For server code that needs the full set. */
export async function listAll<N extends ObjectTypeName>(
  q: Queryable,
  type: N,
  opts: Omit<ListOptions, "pageSize" | "pageToken"> = {},
): Promise<ObjectOf<N>[]> {
  const out: ObjectOf<N>[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listObjects(q, type, { ...opts, pageSize: MAX_PAGE_SIZE, pageToken });
    out.push(...page.data);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken !== undefined);
  return out;
}

/** Follow a join-table link for many sources in one query, keyed by source primary key. */
export async function listLinked(
  q: Queryable,
  source: string,
  linkName: string,
  pks: readonly string[],
  /** Target rows whose firmId is one of these are left out (the access policy's hidden firms). */
  hiddenFirmIds: readonly string[],
): Promise<Record<string, ObjectOf<ObjectTypeName>[]>> {
  const link = findLink(source, linkName);
  if (!link) {
    throw new HttpError(`Unknown link ${source}.${linkName}`, 404);
  }
  const out: Record<string, ObjectOf<ObjectTypeName>[]> = Object.fromEntries(
    pks.map((pk) => [pk, []]),
  );
  if (pks.length === 0) {
    return out;
  }
  const target = OBJECT_TYPES[link.target];
  // A target tied to a firm (the Firm itself, or anything with a firmId) is dropped when that firm is hidden.
  const firmColumn = firmColumnOf(link.target);
  const hide =
    hiddenFirmIds.length > 0 && firmColumn !== null
      ? ` AND (t.${col(firmColumn)} IS NULL OR t.${col(firmColumn)} <> ALL($2::text[]))`
      : "";
  const rows = await q.query(
    `SELECT j.${col(link.sourceColumn)} AS "__source", t.* FROM ${link.joinTable} j
       JOIN ${target.table} t ON t.${col(target.primaryKey)} = j.${col(link.targetColumn)}
      WHERE j.${col(link.sourceColumn)} = ANY($1)${hide}
      ORDER BY t.${col(target.primaryKey)}`,
    hide === "" ? [pks] : [pks, [...hiddenFirmIds]],
  );
  for (const { __source, ...rest } of rows) {
    (out[String(__source)] ??= []).push(toWire(link.target, rest));
  }
  return out;
}
