import { resolveAccess } from "../server/access.js";
import { getDb } from "../server/db/client.js";
import { HttpError } from "../server/errors.js";
import { assertSameOrigin, json, readLimitedText } from "../server/http.js";
import { JSONRPC_PARSE_ERROR, SUPPORTED_PROTOCOL_VERSIONS, handleRpc } from "../server/mcp/rpc.js";
import { toolHost } from "../server/mcp/tools.js";

const rpcError = (status: number, code: number, message: string): Response =>
  json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);

/**
 * The read-only MCP endpoint (Streamable HTTP, stateless): one JSON-RPC message per POST, answered
 * with one JSON body, or a bodiless 202 for a notification. `GET` is not offered (no event stream),
 * so the Worker answers it 405. The persona comes from the same `X-Beacon-Persona` header as every
 * other route.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const version = request.headers.get("mcp-protocol-version");
    if (version !== null && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
      return rpcError(400, -32600, `Unsupported MCP-Protocol-Version: ${version.slice(0, 40)}`);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new HttpError("Content-Type must be application/json", 415);
    }
    let message: unknown;
    try {
      message = JSON.parse(await readLimitedText(request));
    } catch (e) {
      if (e instanceof HttpError) {
        throw e;
      }
      return rpcError(400, JSONRPC_PARSE_ERROR, "Parse error: the body is not valid JSON");
    }
    // The database is opened only by a call that reads: initialize, ping and tools/list never ask.
    const host = toolHost(async () => {
      const db = await getDb();
      return { q: db, access: await resolveAccess(request, db) };
    });
    const reply = await handleRpc(message, host);
    return reply.body === null
      ? new Response(null, { status: reply.status })
      : json(reply.body, reply.status);
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message }, e.status);
    }
    throw e;
  }
}
