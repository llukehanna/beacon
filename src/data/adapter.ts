/**
 * The data adapter: everything the screens ask of the backend, behind one interface. The hooks in
 * hooks.ts call it through React context and nothing else in `src/` touches `fetch`, so a different
 * backend (a Foundry/OSDK client, say) is one new implementation of `DataAdapter`. See README.md.
 */
import type { ActionParams } from "../../shared/actionParams";
import { OBJECT_TYPES } from "../../shared/schema";
import type { ActionName, ObjectOf, ObjectTypeName } from "../../shared/schema";
import type {
  AccuracySummary,
  FirmObservations,
  HomeSummary,
  OperationsSummary,
  ShellCounts,
  SourceDocumentView,
} from "../../shared/summaries";
import { apiFetch } from "./persona";
import type { WireObject } from "./wire";

export type { WireObject } from "./wire";

// ── Contract ──────────────────────────────────────────────────────────────────────────────

export interface ListOptions {
  /** Equality filters, by property. */
  where?: Record<string, { $eq: unknown }>;
  orderBy?: Record<string, "asc" | "desc">;
  /** Rows per page (the server caps it at 1000). */
  pageSize?: number;
  /** The `nextPageToken` of the previous page. */
  pageToken?: string;
}

export interface Page<T> {
  data: T[];
  /** Null on the last page. */
  nextPageToken: string | null;
}

/** What an action reports back. */
export interface ActionResponse {
  /** Primary keys of the objects the action created and modified. */
  created?: string[];
  modified?: string[];
  /** Object types the action wrote to; absent means "unknown", and the client refreshes everything. */
  types?: string[];
  note?: string;
}

/** Parameters of a query function that takes none. */
export type NoParams = Record<string, never>;

/** The query functions the client calls (server/functions/), with their parameters and results. */
export interface FunctionSignatures {
  homeSummary: { params: NoParams; result: HomeSummary };
  accuracySummary: { params: NoParams; result: AccuracySummary };
  operationsSummary: { params: NoParams; result: OperationsSummary };
  shellCounts: { params: NoParams; result: ShellCounts };
  firmObservations: { params: { firmId: string }; result: FirmObservations };
  sourceDocument: { params: { provider: string; firmId: string }; result: SourceDocumentView };
}

export type FunctionName = keyof FunctionSignatures;
export type FunctionParams<F extends FunctionName> = FunctionSignatures[F]["params"];
export type FunctionResult<F extends FunctionName> = FunctionSignatures[F]["result"];

/** The functions that take no parameters. */
export type ParamlessFunctionName = {
  [F in FunctionName]: FunctionParams<F> extends NoParams ? F : never;
}[FunctionName];

export interface DataAdapter {
  /** One page of objects of a type. */
  listObjects<T extends ObjectTypeName>(type: T, opts?: ListOptions): Promise<Page<ObjectOf<T>>>;
  /** One object by primary key; null when it does not exist (or the persona may not see it). */
  getObject<T extends ObjectTypeName>(type: T, id: string): Promise<ObjectOf<T> | null>;
  /**
   * The objects at the far end of a link, for several source objects at once, keyed by source
   * primary key. A source with no links has an empty list. Not paged: the whole set comes back.
   */
  listLinked(
    from: ObjectTypeName,
    link: string,
    ids: readonly string[],
  ): Promise<Record<string, WireObject[]>>;
  /** Runs an action. Rejects with the server's reason when the action is refused or fails. */
  applyAction<N extends ActionName>(name: N, params: ActionParams<N>): Promise<ActionResponse>;
  /** Runs a read-only query function. */
  runFunction<F extends FunctionName>(
    name: F,
    params: FunctionParams<F>,
  ): Promise<FunctionResult<F>>;
}

// ── Errors ────────────────────────────────────────────────────────────────────────────────

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";
const GENERIC_MESSAGE = "Something went wrong. Try again.";

/** The server answered with a failure status. `message` is its `{ error }` text. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The request never got an answer (offline, DNS, connection reset). */
export class NetworkError extends Error {
  constructor() {
    super(NETWORK_MESSAGE);
    this.name = "NetworkError";
  }
}

// What `fetch` rejects with when there is no connection, by browser.
const FETCH_FAILURE = /failed to fetch|load failed|networkerror|network request failed/i;

/**
 * Readable text for anything thrown: the server's `{ error }` text when there is one, a short
 * sentence for a network failure, an Error's message, a string as it is, and a generic sentence
 * for the rest. Never "[object Object]" and never an "Error: " prefix.
 */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error === "" ? GENERIC_MESSAGE : error;
  }
  if (error instanceof TypeError && FETCH_FAILURE.test(error.message)) {
    return NETWORK_MESSAGE;
  }
  if (error instanceof Error) {
    return error.message === "" ? GENERIC_MESSAGE : error.message;
  }
  if (typeof error === "object" && error !== null && "error" in error) {
    const text = error.error;
    if (typeof text === "string" && text !== "") {
      return text;
    }
  }
  return GENERIC_MESSAGE;
}

// ── REST implementation ───────────────────────────────────────────────────────────────────

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await apiFetch(path, init);
  } catch {
    throw new NetworkError();
  }
}

async function readJson<T>(res: Response): Promise<T> {
  // The wire boundary: the body is JSON of whatever shape the endpoint returned, taken as T.
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    throw new HttpError(
      typeof body.error === "string" && body.error !== ""
        ? body.error
        : `The server returned an error (HTTP ${res.status}).`,
      res.status,
    );
  }
  return body as T;
}

function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listObjects<T extends ObjectTypeName>(
  type: T,
  opts: ListOptions = {},
): Promise<Page<ObjectOf<T>>> {
  const params = new URLSearchParams({ type });
  if (opts.where) {
    params.set("where", JSON.stringify(opts.where));
  }
  if (opts.orderBy) {
    params.set("orderBy", JSON.stringify(opts.orderBy));
  }
  if (opts.pageSize !== undefined) {
    params.set("pageSize", String(opts.pageSize));
  }
  if (opts.pageToken !== undefined) {
    params.set("pageToken", opts.pageToken);
  }
  return readJson<Page<ObjectOf<T>>>(await request(`/api/objects?${params.toString()}`));
}

async function getObject<T extends ObjectTypeName>(
  type: T,
  id: string,
): Promise<ObjectOf<T> | null> {
  const page = await listObjects(type, {
    where: { [OBJECT_TYPES[type].primaryKey]: { $eq: id } },
    pageSize: 1,
  });
  return page.data[0] ?? null;
}

async function listLinked(
  from: ObjectTypeName,
  link: string,
  ids: readonly string[],
): Promise<Record<string, WireObject[]>> {
  const res = await post("/api/links", { type: from, link, pks: ids });
  return (await readJson<{ data: Record<string, WireObject[]> }>(res)).data;
}

async function applyAction<N extends ActionName>(
  name: N,
  params: ActionParams<N>,
): Promise<ActionResponse> {
  return readJson<ActionResponse>(await post("/api/actions", { action: name, params }));
}

async function runFunction<F extends FunctionName>(
  name: F,
  params: FunctionParams<F>,
): Promise<FunctionResult<F>> {
  const query = new URLSearchParams({ name });
  if (Object.keys(params).length > 0) {
    query.set("params", JSON.stringify(params));
  }
  const res = await request(`/api/functions?${query.toString()}`);
  return (await readJson<{ value: FunctionResult<F> }>(res)).value;
}

/** The adapter for this app's own backend (the Cloudflare Worker and Postgres behind `/api`). */
export const restAdapter: DataAdapter = {
  listObjects,
  getObject,
  listLinked,
  applyAction,
  runFunction,
};

/** Restores the demo data. Demo-only, so it is not part of the adapter contract. */
export async function resetDemo(): Promise<{ firms: number }> {
  return readJson<{ firms: number }>(await request("/api/reset", { method: "POST" }));
}
