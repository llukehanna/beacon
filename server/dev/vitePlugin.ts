import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const ROUTES = new Set(["objects", "links", "actions", "reset", "functions", "mcp"]);

async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const chunks: Buffer[] = [];
  // A GET or HEAD has no body to wait for, so it cannot fail on a connection that closed early.
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const c of req) {
      chunks.push(c as Buffer);
    }
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") {
      headers.set(k, v);
    }
  }
  const hasBody = chunks.length > 0;
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

/**
 * True when the browser closed the connection before the answer was sent: a navigation or a
 * cancelled fetch abandons its requests, and Node then fails the read with "aborted". There is
 * nobody left to answer, so it is not an error. Only the connection says so: an ECONNRESET from
 * anything else (a database socket) on a live connection is a real failure and goes to next().
 * `req.destroyed` is not used: Node sets it once a request body has been read in full, which is
 * true for every POST here.
 */
function abandoned(req: IncomingMessage, res: ServerResponse): boolean {
  return req.socket.destroyed || res.destroyed;
}

/** Routes /api/<name> to api/<name>.ts during `vite dev`, mirroring the Worker in worker/. */
export function devApi(): Plugin {
  return {
    name: "beacon-dev-api",
    configureServer(server) {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- connect ignores the returned promise; failures go to next() below
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const m = /^\/api\/([a-z]+)$/.exec(url.pathname);
        if (!m || !ROUTES.has(m[1])) {
          return next();
        }
        try {
          const mod = (await server.ssrLoadModule(`/api/${m[1]}.ts`)) as Record<string, unknown>;
          const handler = mod[req.method ?? "GET"];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            res.end();
            return;
          }
          // Boundary cast: ssrLoadModule returns an untyped module, and every api/<name>.ts export
          // named after an HTTP method is a (Request) => Promise<Response> handler.
          const response = await (handler as (request: Request) => Promise<Response>)(
            await toRequest(req, url),
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          // Passed to next(), Vite would log it and send it to every open page as an error overlay,
          // which then covers whatever test or visitor is on the page when it arrives.
          if (!abandoned(req, res)) {
            next(e);
          }
        }
      });
    },
  };
}
