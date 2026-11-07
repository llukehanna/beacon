import { HttpError } from "./errors.js";

/** Also set on static assets by public/_headers (which adds the CSP). */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

export const MAX_BODY_BYTES = 65_536;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      // The body depends on the demo persona header, so no cache may share it between personas.
      vary: "X-Beacon-Persona",
      ...SECURITY_HEADERS,
    },
  });
}

/** Known errors keep their status and message; anything else is logged and hidden. */
export function jsonError(e: unknown): Response {
  if (e instanceof HttpError) {
    return json({ error: e.message }, e.status);
  }
  // Postgres class 22 (data exception): a filter value of the wrong type, e.g. {"employees": {"$eq": "abc"}}.
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("22")) {
    return json({ error: "A value has the wrong type for its property" }, 400);
  }
  // Class 40 (deadlock, serialization failure): two actions raced on the same objects.
  if (typeof code === "string" && code.startsWith("40")) {
    return json(
      { error: "Another change touched this record at the same moment. Try again." },
      409,
    );
  }
  // Operational signal for the server log: unexpected errors are hidden from the caller.
  // eslint-disable-next-line no-console
  console.error(e);
  return json({ error: "Internal error" }, 500);
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Browsers send Origin on cross-site POSTs; refuse any whose host is not this
 * server's. Requests without Origin (curl, cron) pass. A local dev setup may
 * differ in port (Vite on 5173 proxying to a Worker), so local-to-local is allowed.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return;
  }
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    throw new HttpError("Cross-origin requests are not allowed", 403);
  }
  const to = new URL(request.url);
  const bothLocal = LOCAL_HOSTNAMES.has(from.hostname) && LOCAL_HOSTNAMES.has(to.hostname);
  if (!bothLocal && from.host !== to.host) {
    throw new HttpError("Cross-origin requests are not allowed", 403);
  }
}

/** Reads the body as text, stopping as soon as it passes MAX_BODY_BYTES. */
export async function readLimitedText(request: Request): Promise<string> {
  const tooLarge = () => new HttpError("Request body is too large", 413);
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) {
    throw tooLarge();
  }
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError("Content-Type must be application/json", 415);
  }
  const text = await readLimitedText(request);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError("Request body must be JSON");
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new HttpError("Request body must be a JSON object");
  }
  return v as Record<string, unknown>;
}

export function jsonParam(url: URL, name: string): unknown {
  const raw = url.searchParams.get(name);
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(`Query parameter "${name}" must be JSON`);
  }
}
