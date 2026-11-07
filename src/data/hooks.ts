/**
 * Drop-in replacements for the OSDK React hooks the pages use, backed by
 * TanStack Query and a `DataAdapter` (adapter.ts; the REST one unless a
 * provider says otherwise). Same names and the same return fields, so page
 * code only changes its import lines.
 *
 *  - useOsdkObjects pages through listObjects: `pageSize` sets the page,
 *    `autoFetchMore` keeps fetching until the last one, and `hasMore` /
 *    `fetchMore` / `refetch` expose the rest.
 *  - useOsdkQuery calls a server query function (OSDK's `useOsdkFunction`).
 *  - A successful action refreshes only what it could have changed: the
 *    object types it wrote to, links that touch them, and every function
 *    result. An action that names no types refreshes everything.
 */
import React from "react";
import {
  type QueryClient,
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Persona } from "../../shared/accessPolicy";
import type { ActionParams } from "../../shared/actionParams";
import type { ActionName, ObjectTypeName } from "../../shared/schema";
import { useDataAdapter } from "./AdapterContext";
import type {
  ActionResponse,
  DataAdapter,
  FunctionName,
  FunctionParams,
  FunctionResult,
  ListOptions,
  ParamlessFunctionName,
} from "./adapter";
import type { ActionToken, ObjectTypeToken } from "./ontology";
import { usePersona } from "./persona";
import { linkQueryReads, normalizeError, toLinkMap } from "./wire";

export interface ObjectsOptions extends Pick<ListOptions, "where" | "orderBy" | "pageSize"> {
  /** Keep requesting pages until the last; `data` stays undefined until then. */
  autoFetchMore?: boolean;
  enabled?: boolean;
  /** How long a fetched list counts as fresh, in ms (the client default otherwise). 0 refetches on every mount. */
  staleTime?: number;
}

// The query options below are the whole of what each hook asks of the adapter, kept apart from the
// hooks so tests can run them against a fake adapter without rendering anything.

export function objectsQueryOptions<N extends ObjectTypeName>(
  adapter: DataAdapter,
  type: N,
  opts: ObjectsOptions,
  persona: Persona,
) {
  const { where, orderBy, pageSize } = opts;
  return infiniteQueryOptions({
    // The persona is last, so the prefixes the invalidations use (["objects", type]) still match.
    queryKey: ["objects", type, where ?? null, orderBy ?? null, pageSize ?? null, persona],
    queryFn: ({ pageParam }) =>
      adapter.listObjects(type, { where, orderBy, pageSize, pageToken: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: opts.enabled ?? true,
    ...(opts.staleTime === undefined ? {} : { staleTime: opts.staleTime }),
  });
}

export function useOsdkObjects<N extends ObjectTypeName>(
  type: ObjectTypeToken<N>,
  opts: ObjectsOptions = {},
) {
  const { autoFetchMore = false } = opts;
  const adapter = useDataAdapter();
  const persona = usePersona();
  const q = useInfiniteQuery(objectsQueryOptions(adapter, type.apiName, opts, persona));
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = q;
  const more = hasNextPage === true;
  React.useEffect(() => {
    // A failed page is not retried here (that would loop); the error is surfaced instead.
    if (autoFetchMore && more && !isFetchingNextPage && !isFetching && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [autoFetchMore, more, isFetchingNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

  // With autoFetchMore the caller asked for everything, so a partial list is
  // never exposed (counts would flicker upward); a refetch keeps the old
  // complete list until the new one has arrived.
  const settled = !autoFetchMore || !more;
  const data = React.useMemo(
    () => (settled ? q.data?.pages.flatMap((p) => p.data) : undefined),
    [settled, q.data],
  );
  const fetchMore = React.useCallback(async (): Promise<void> => {
    await fetchNextPage();
  }, [fetchNextPage]);
  // Try the list again after a failure (refetch resumes at the pages already held, or the first).
  const retry = React.useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);
  return {
    data,
    // A page that failed stops the wait; `error` carries the reason.
    isLoading: q.isLoading || (autoFetchMore && more && !isFetchNextPageError),
    error: normalizeError(q.error),
    hasMore: more,
    fetchMore: more ? fetchMore : undefined,
    refetch: retry,
  };
}

export function functionQueryOptions<F extends FunctionName>(
  adapter: DataAdapter,
  name: F,
  params: FunctionParams<F>,
  persona: Persona,
) {
  return queryOptions({
    queryKey: ["functions", name, params, persona],
    queryFn: () => adapter.runFunction(name, params),
  });
}

/**
 * A server query function (server/functions/), like OSDK's `useOsdkFunction`. Results are cached per
 * name, params and persona, and refetched after any action. A function that takes parameters is
 * passed them, or `null` while they are not known yet (the query then waits).
 */
export function useOsdkQuery<F extends ParamlessFunctionName>(
  name: F,
  params?: undefined,
  opts?: { enabled?: boolean },
): QueryResult<FunctionResult<F>>;
export function useOsdkQuery<F extends FunctionName>(
  name: F,
  params: FunctionParams<F> | null,
  opts?: { enabled?: boolean },
): QueryResult<FunctionResult<F>>;
export function useOsdkQuery<F extends FunctionName>(
  name: F,
  params?: FunctionParams<F> | null,
  opts: { enabled?: boolean } = {},
): QueryResult<FunctionResult<F>> {
  const adapter = useDataAdapter();
  const persona = usePersona();
  // The overloads make `params` present for every function that takes some, so the empty object
  // only ever stands in for a function that takes none.
  const resolved = (params ?? {}) as FunctionParams<F>;
  const q = useQuery({
    ...functionQueryOptions(adapter, name, resolved, persona),
    enabled: (opts.enabled ?? true) && params !== null,
  });
  return { data: q.data, isLoading: q.isLoading, error: normalizeError(q.error) };
}

interface QueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
}

/** Refresh what an action may have changed (everything when it can't say). */
export function invalidateAfterAction(qc: QueryClient, res: ActionResponse): Promise<unknown> {
  const types = res.types ?? [];
  if (types.length === 0) {
    return qc.invalidateQueries();
  }
  const touched = new Set(types);
  return Promise.all([
    ...types.map((t) => qc.invalidateQueries({ queryKey: ["objects", t] })),
    qc.invalidateQueries({
      queryKey: ["links"],
      predicate: (query) => linkQueryReads(query.queryKey, touched),
    }),
    qc.invalidateQueries({ queryKey: ["functions"] }),
  ]);
}

export function actionMutationOptions<N extends ActionName>(
  adapter: DataAdapter,
  qc: QueryClient,
  name: N,
) {
  return {
    mutationFn: (params: ActionParams<N>) => adapter.applyAction(name, params),
    // Returning the promise makes applyAction resolve only after the
    // refetch lands, so `.then(refresh)` callers see fresh data.
    onSuccess: (res: ActionResponse) => invalidateAfterAction(qc, res),
  };
}

/**
 * An action, with the parameters its server definition validates (shared/actionParams.ts).
 * `applyAction` rejects when the action fails, so a caller catches it; the same failure is on
 * `error` (show it with `errorMessage`) until the next attempt.
 */
export function useOsdkAction<N extends ActionName>(action: ActionToken<N>) {
  const adapter = useDataAdapter();
  const qc = useQueryClient();
  const m = useMutation(actionMutationOptions(adapter, qc, action.apiName));
  return {
    applyAction: (params: ActionParams<N>): Promise<ActionResponse> => m.mutateAsync(params),
    isPending: m.isPending,
    error: normalizeError(m.error),
  };
}

/** What traversing a link needs of its source: the object's type and key. */
export interface LinkSource {
  readonly $apiName: ObjectTypeName;
  readonly $primaryKey: string;
}

export function useLinks(
  source: LinkSource | readonly LinkSource[] | null | undefined,
  linkName: string,
) {
  const sources: readonly LinkSource[] =
    source == null ? [] : "$primaryKey" in source ? [source] : source;
  const type = sources[0]?.$apiName;
  const pks = sources.map((s) => s.$primaryKey);
  const adapter = useDataAdapter();
  const persona = usePersona();
  const q = useQuery({
    queryKey: ["links", type ?? null, linkName, pks, persona],
    queryFn: () => adapter.listLinked(type, linkName, pks),
    enabled: type !== undefined && pks.length > 0,
  });
  const linkedObjectsBySourcePrimaryKey = React.useMemo(() => toLinkMap(q.data), [q.data]);
  return {
    linkedObjectsBySourcePrimaryKey,
    isLoading: q.isLoading,
    error: normalizeError(q.error),
  };
}

export function useObservableClient() {
  const qc = useQueryClient();
  return React.useMemo(
    () => ({
      invalidateObjects: () =>
        Promise.all([
          qc.invalidateQueries({ queryKey: ["objects"] }),
          qc.invalidateQueries({ queryKey: ["functions"] }),
        ]),
    }),
    [qc],
  );
}
