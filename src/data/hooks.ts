/**
 * Drop-in replacements for the OSDK React hooks the pages use, backed by
 * TanStack Query and the /api endpoints. Same names and the same return
 * fields, so page code only changes its import lines.
 *
 *  - useOsdkObjects pages through /api/objects: `pageSize` sets the page,
 *    `autoFetchMore` keeps fetching until the last one, and `hasMore` /
 *    `fetchMore` expose the rest.
 *  - useOsdkQuery calls a server query function (OSDK's `useOsdkFunction`).
 *  - A successful action refreshes only what it could have changed: the
 *    object types it wrote to, links that touch them, and every function
 *    result. An action that names no types refreshes everything.
 */
import React from "react";
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ObjectOf, ObjectTypeName } from "../../shared/schema";
import {
  type ActionResponse,
  type ObjectQuery,
  fetchFunction,
  fetchLinks,
  fetchObjectsPage,
  postAction,
} from "./api";
import type { ActionToken, ObjectTypeToken } from "./ontology";
import { usePersona } from "./persona";
import { type WireObject, linkQueryReads, normalizeError, toLinkMap } from "./wire";

export interface ObjectsOptions extends ObjectQuery {
  /** Rows per request (the server caps it at 1000). */
  pageSize?: number;
  /** Keep requesting pages until the last; `data` stays undefined until then. */
  autoFetchMore?: boolean;
  enabled?: boolean;
  /** How long a fetched list counts as fresh, in ms (the client default otherwise). 0 refetches on every mount. */
  staleTime?: number;
}

export function useOsdkObjects<N extends ObjectTypeName>(
  type: ObjectTypeToken<N>,
  opts: ObjectsOptions = {},
) {
  const { where, orderBy, pageSize, autoFetchMore = false } = opts;
  const persona = usePersona();
  const q = useInfiniteQuery({
    // The persona is last, so the prefixes the invalidations use (["objects", type]) still match.
    queryKey: ["objects", type.apiName, where ?? null, orderBy ?? null, pageSize ?? null, persona],
    queryFn: ({ pageParam }) =>
      fetchObjectsPage(type.apiName, { where, orderBy, pageSize, pageToken: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: opts.enabled ?? true,
    ...(opts.staleTime === undefined ? {} : { staleTime: opts.staleTime }),
  });
  const { hasNextPage, isFetchingNextPage, isFetching, isFetchNextPageError, fetchNextPage } = q;
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
    () =>
      settled ? (q.data?.pages.flatMap((p) => p.data) as ObjectOf<N>[] | undefined) : undefined,
    [settled, q.data],
  );
  const fetchMore = React.useCallback(async (): Promise<void> => {
    await fetchNextPage();
  }, [fetchNextPage]);
  return {
    data,
    // A page that failed stops the wait; `error` carries the reason.
    isLoading: q.isLoading || (autoFetchMore && more && !isFetchNextPageError),
    error: normalizeError(q.error),
    hasMore: more,
    fetchMore: more ? fetchMore : undefined,
  };
}

/**
 * A server query function (server/functions/), like OSDK's `useOsdkFunction`.
 * Results are cached per name, params and persona, and refetched after any action.
 */
export function useOsdkQuery<T>(
  name: string,
  params: Record<string, unknown> = {},
  opts: { enabled?: boolean } = {},
) {
  const persona = usePersona();
  const q = useQuery({
    queryKey: ["functions", name, params, persona],
    queryFn: () => fetchFunction<T>(name, params),
    enabled: opts.enabled ?? true,
  });
  return { data: q.data, isLoading: q.isLoading, error: normalizeError(q.error) };
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

export function useOsdkAction(action: ActionToken) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (params: Record<string, unknown>) => postAction(action.apiName, params),
    // Returning the promise makes applyAction resolve only after the
    // refetch lands, so `.then(refresh)` callers see fresh data.
    onSuccess: (res) => invalidateAfterAction(qc, res),
  });
  return {
    applyAction: (params: Record<string, unknown>): Promise<ActionResponse> =>
      m.mutateAsync(params),
    isPending: m.isPending,
    error: normalizeError(m.error),
  };
}

export function useLinks(
  source: WireObject | readonly WireObject[] | null | undefined,
  linkName: string,
  _opts?: { pageSize?: number; $select?: unknown },
) {
  const sources: readonly WireObject[] =
    source == null ? [] : Array.isArray(source) ? source : [source as WireObject];
  const type = sources[0]?.$apiName;
  const pks = sources.map((s) => s.$primaryKey);
  const persona = usePersona();
  const q = useQuery({
    queryKey: ["links", type ?? null, linkName, pks, persona],
    queryFn: () => fetchLinks(type as string, linkName, pks),
    enabled: type !== undefined && pks.length > 0,
  });
  const linkedObjectsBySourcePrimaryKey = React.useMemo(() => toLinkMap(q.data), [q.data]);
  return {
    linkedObjectsBySourcePrimaryKey,
    hasMore: false,
    isLoading: q.isLoading,
    error: normalizeError(q.error),
  };
}

export function useObservableClient() {
  const qc = useQueryClient();
  return React.useMemo(
    () => ({
      invalidateObjects: (_obj?: unknown) =>
        Promise.all([
          qc.invalidateQueries({ queryKey: ["objects"] }),
          qc.invalidateQueries({ queryKey: ["functions"] }),
        ]),
    }),
    [qc],
  );
}
