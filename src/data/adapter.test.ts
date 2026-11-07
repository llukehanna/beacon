import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, NetworkError, errorMessage, restAdapter } from "./adapter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("errorMessage", () => {
  const cases: Array<[string, unknown, string]> = [
    [
      "an HttpError carries the server's text",
      new HttpError("Firm f9 not found", 404),
      "Firm f9 not found",
    ],
    [
      "a response body with an error field",
      { error: "rejectionRationale is required" },
      "rejectionRationale is required",
    ],
    [
      "a network failure",
      new NetworkError(),
      "Could not reach the server. Check your connection and try again.",
    ],
    [
      "the TypeError fetch throws when offline",
      new TypeError("Failed to fetch"),
      "Could not reach the server. Check your connection and try again.",
    ],
    ["an Error says its message, not 'Error: ...'", new Error("boom"), "boom"],
    ["a string is itself", "already readable", "already readable"],
    ["an object with no text of its own", { code: 7 }, "Something went wrong. Try again."],
    ["an error with an empty message", new Error(""), "Something went wrong. Try again."],
    ["null", null, "Something went wrong. Try again."],
    ["undefined", undefined, "Something went wrong. Try again."],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(errorMessage(input)).toBe(expected);
  });

  it("never prints [object Object] or an Error: prefix", () => {
    for (const input of [{}, { a: { b: 1 } }, new Error("x"), [1, 2], 5, Symbol("s")]) {
      const text = errorMessage(input);
      expect(text).not.toContain("[object Object]");
      expect(text).not.toMatch(/^\w*Error: /);
    }
  });
});

function stubFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(respond(url, init));
    }),
  );
  return calls;
}

/** The JSON a request carried. */
function sentBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("restAdapter", () => {
  it("lists objects with the query on the URL", async () => {
    const calls = stubFetch(() => json({ data: [], nextPageToken: null }));
    const page = await restAdapter.listObjects("Firm", {
      where: { firmId: { $eq: "f1" } },
      orderBy: { firmName: "asc" },
      pageSize: 5,
      pageToken: "t",
    });
    expect(page).toEqual({ data: [], nextPageToken: null });
    const url = new URL(calls[0].url, "http://x");
    expect(url.pathname).toBe("/api/objects");
    expect(url.searchParams.get("type")).toBe("Firm");
    expect(url.searchParams.get("where")).toBe('{"firmId":{"$eq":"f1"}}');
    expect(url.searchParams.get("orderBy")).toBe('{"firmName":"asc"}');
    expect(url.searchParams.get("pageSize")).toBe("5");
    expect(url.searchParams.get("pageToken")).toBe("t");
  });

  it("gets one object by primary key, or null when there is none", async () => {
    const calls = stubFetch((url) =>
      decodeURIComponent(url).includes('"f1"')
        ? json({
            data: [{ $apiName: "Firm", $primaryKey: "f1", firmId: "f1" }],
            nextPageToken: null,
          })
        : json({ data: [], nextPageToken: null }),
    );
    expect((await restAdapter.getObject("Firm", "f1"))?.firmId).toBe("f1");
    expect(await restAdapter.getObject("Firm", "nope")).toBeNull();
    const where = new URL(calls[0].url, "http://x").searchParams.get("where");
    expect(where).toBe('{"firmId":{"$eq":"f1"}}');
  });

  it("traverses a link for several sources in one request", async () => {
    const calls = stubFetch(() =>
      json({ data: { s1: [{ $apiName: "Firm", $primaryKey: "f1" }] } }),
    );
    const linked = await restAdapter.listLinked("SearchList", "firms", ["s1", "s2"]);
    expect(linked.s1[0].$primaryKey).toBe("f1");
    expect(calls[0].url).toBe("/api/links");
    expect(sentBody(calls[0].init)).toEqual({
      type: "SearchList",
      link: "firms",
      pks: ["s1", "s2"],
    });
  });

  it("posts an action and returns its response", async () => {
    const calls = stubFetch(() => json({ created: ["d1"], types: ["ReviewDecision"] }));
    const res = await restAdapter.applyAction("rejectFirm", {
      firm: "f1",
      rejectionRationale: "no fit",
    });
    expect(res.created).toEqual(["d1"]);
    expect(sentBody(calls[0].init)).toEqual({
      action: "rejectFirm",
      params: { firm: "f1", rejectionRationale: "no fit" },
    });
  });

  it("runs a function and unwraps its value", async () => {
    const calls = stubFetch(() => json({ value: { open: 1, review: 2, activeMandates: 3 } }));
    const counts = await restAdapter.runFunction("shellCounts", {});
    expect(counts.review).toBe(2);
    expect(new URL(calls[0].url, "http://x").searchParams.get("params")).toBeNull();
    await restAdapter.runFunction("firmObservations", { firmId: "f1" });
    expect(new URL(calls[1].url, "http://x").searchParams.get("params")).toBe('{"firmId":"f1"}');
  });

  it("sends the persona header", async () => {
    const calls = stubFetch(() => json({ value: {} }));
    await restAdapter.runFunction("homeSummary", {});
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-beacon-persona")).not.toBeNull();
  });

  it("turns an error response into an HttpError with the server's text", async () => {
    stubFetch(() => json({ error: "Firm f9 not found" }, 404));
    const err: unknown = await restAdapter
      .applyAction("qualifyFirm", { firm: "f9" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect(errorMessage(err)).toBe("Firm f9 not found");
  });

  it("gives a plain sentence when an error response has no body", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const err: unknown = await restAdapter.runFunction("homeSummary", {}).catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("The server returned an error (HTTP 502).");
  });

  it("turns a failed fetch into a NetworkError", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const err: unknown = await restAdapter.runFunction("homeSummary", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(errorMessage(err)).toBe(
      "Could not reach the server. Check your connection and try again.",
    );
  });
});
