/** A stand-in `DataAdapter` for tests: methods a test does not supply reject, so a stray call is loud. */
import type { ObjectOf, ObjectTypeName } from "../../shared/schema";
import type { DataAdapter, Page } from "./adapter";

/** One recorded `listObjects` call. */
export interface ListRequest {
  type: ObjectTypeName;
  pageToken: string | undefined;
}

type Handlers = Partial<DataAdapter>;

const unexpected = (method: string) => () =>
  Promise.reject(new Error(`Unexpected adapter call: ${method}`));

export function fakeAdapter(handlers: Handlers = {}): DataAdapter {
  return {
    listObjects: handlers.listObjects ?? unexpected("listObjects"),
    getObject: handlers.getObject ?? unexpected("getObject"),
    listLinked: handlers.listLinked ?? unexpected("listLinked"),
    applyAction: handlers.applyAction ?? unexpected("applyAction"),
    runFunction: handlers.runFunction ?? unexpected("runFunction"),
  };
}

/**
 * A `listObjects` that serves the given rows page by page, whatever type is asked for. The method
 * is generic in the type, which canned rows cannot be, so they are taken as the asked-for type
 * once, here.
 */
export function pagedRows(
  pages: readonly (readonly Record<string, unknown>[])[],
  seen: ListRequest[] = [],
): DataAdapter["listObjects"] {
  return <T extends ObjectTypeName>(type: T, opts: { pageToken?: string } = {}) => {
    seen.push({ type, pageToken: opts.pageToken });
    const at = opts.pageToken === undefined ? 0 : Number(opts.pageToken);
    const rows = pages[at] ?? [];
    const page = {
      data: rows,
      nextPageToken: at + 1 < pages.length ? String(at + 1) : null,
    };
    return Promise.resolve(page as unknown as Page<ObjectOf<T>>);
  };
}
