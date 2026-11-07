import type { ObjectOf, ObjectTypeName } from "../../shared/schema";
import { apiFetch } from "./persona";
import { type WireObject, serializeParams } from "./wire";

export type { WireObject } from "./wire";

export class ActionFailedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ActionFailedError";
  }
}

async function readJson<T>(res: Response): Promise<T> {
  // The wire boundary: the body is JSON of whatever shape the endpoint returned, taken as T.
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    throw new ActionFailedError(
      typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

export interface ObjectQuery {
  where?: Record<string, { $eq: unknown }>;
  orderBy?: Record<string, "asc" | "desc">;
}

export interface ObjectPageQuery extends ObjectQuery {
  pageSize?: number;
  pageToken?: string;
}

export interface ObjectPage<N extends ObjectTypeName = ObjectTypeName> {
  data: ObjectOf<N>[];
  /** Null on the last page. */
  nextPageToken: string | null;
}

export async function fetchObjectsPage<N extends ObjectTypeName>(
  type: N,
  q: ObjectPageQuery = {},
): Promise<ObjectPage<N>> {
  const params = new URLSearchParams({ type });
  if (q.where) {
    params.set("where", JSON.stringify(q.where));
  }
  if (q.orderBy) {
    params.set("orderBy", JSON.stringify(q.orderBy));
  }
  if (q.pageSize !== undefined) {
    params.set("pageSize", String(q.pageSize));
  }
  if (q.pageToken !== undefined) {
    params.set("pageToken", q.pageToken);
  }
  return readJson<ObjectPage<N>>(await apiFetch(`/api/objects?${params.toString()}`));
}

/** Runs a server query function (see server/functions/) and returns its value. */
export async function fetchFunction<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const query = new URLSearchParams({ name });
  if (Object.keys(params).length > 0) {
    query.set("params", JSON.stringify(params));
  }
  return (await readJson<{ value: T }>(await apiFetch(`/api/functions?${query.toString()}`))).value;
}

export async function fetchLinks(
  type: string,
  link: string,
  pks: string[],
): Promise<Record<string, WireObject[]>> {
  const res = await apiFetch("/api/links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, link, pks }),
  });
  return (await readJson<{ data: Record<string, WireObject[]> }>(res)).data;
}

export interface ActionResponse {
  /** Primary keys of the objects the action created and modified. */
  created?: string[];
  modified?: string[];
  /** Object types the action wrote to; absent means "unknown", and the client refreshes everything. */
  types?: string[];
  note?: string;
}

export async function postAction(
  action: string,
  params: Record<string, unknown>,
): Promise<ActionResponse> {
  const res = await apiFetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, params: serializeParams(params) }),
  });
  return readJson<ActionResponse>(res);
}

export async function resetDemo(): Promise<{ firms: number }> {
  return readJson<{ firms: number }>(await apiFetch("/api/reset", { method: "POST" }));
}
