/** Pure helpers between the hooks and the HTTP API (kept React-free for tests). */
import { findLink } from "../../shared/schema";

export type WireObject = Record<string, unknown> & { $apiName: string; $primaryKey: string };

export function toLinkMap(
  data: Record<string, WireObject[]> | undefined,
): Map<string, WireObject[]> {
  return new Map(Object.entries(data ?? {}));
}

/** TanStack reports "no error" as null; the pages compare against undefined. */
export function normalizeError(e: Error | null): Error | undefined {
  return e ?? undefined;
}

/**
 * Does a cached `["links", sourceType, linkName, pks]` query read data of any
 * of `types`? A link's result is its target objects, and its keys are source
 * objects, so a change to either side makes it stale. An unrecognised key is
 * treated as stale: refetching too much is safe, too little shows old data.
 */
export function linkQueryReads(queryKey: readonly unknown[], types: ReadonlySet<string>): boolean {
  const [, source, name] = queryKey;
  const link =
    typeof source === "string" && typeof name === "string" ? findLink(source, name) : undefined;
  return link === undefined || types.has(link.source) || types.has(link.target);
}
