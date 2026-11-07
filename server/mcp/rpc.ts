/**
 * JSON-RPC 2.0 for the Model Context Protocol over Streamable HTTP, hand-rolled and stateless:
 * one POSTed message in, one JSON message (or a bare 202 for a notification) out, no session and no
 * event stream. Pure: it never touches HTTP or the database; the tools are reached through a host.
 */
import { HttpError } from "../errors.js";

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/** Newest first: `initialize` answers with the client's version when it is here, else the first. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const SERVER_INFO = { name: "beacon", title: "Beacon", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "Read-only access to Beacon, a deal-sourcing demo with synthetic data: search firms, read a " +
  "firm's cited evidence, and list screening rules. Nothing here can change data. Send the " +
  "X-Beacon-Persona header (analyst, deal_lead or compliance) to choose whose view you get.";

/** A failure that becomes a JSON-RPC error object. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** What the protocol needs from the tools. `call` throws an RpcError for an unknown tool or bad arguments. */
export interface ToolHost {
  list(): ToolDescriptor[];
  call(name: string, args: unknown): Promise<ToolResult>;
}

/** What to send back: an HTTP status and a JSON body, or no body at all (a notification). */
export interface RpcReply {
  status: number;
  body: unknown;
}

type Id = string | number;

const failure = (id: Id | null, code: number, message: string, status = 200): RpcReply => ({
  status,
  body: { jsonrpc: "2.0", id, error: { code, message } },
});

const success = (id: Id, result: unknown): RpcReply => ({
  status: 200,
  body: { jsonrpc: "2.0", id, result },
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isId = (v: unknown): v is Id => typeof v === "string" || typeof v === "number";

/** The version to speak: the client's when supported, else the newest this server speaks. */
export function negotiateVersion(requested: string): string {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

/**
 * Answers one parsed JSON-RPC message. A batch (an array) is refused: the transport carries one
 * message per POST. A notification, and a response to a request this server never sent, get a
 * bodiless 202.
 */
export async function handleRpc(message: unknown, host: ToolHost): Promise<RpcReply> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return failure(null, JSONRPC_INVALID_REQUEST, "Expected a single JSON-RPC 2.0 message", 400);
  }
  const { id, method } = message;

  // A response (result or error, no method): this server sends no requests, so nothing awaits it.
  if (method === undefined && ("result" in message || "error" in message)) {
    return { status: 202, body: null };
  }
  if (typeof method !== "string" || method === "") {
    return failure(isId(id) ? id : null, JSONRPC_INVALID_REQUEST, '"method" must be a string', 400);
  }
  if (id === undefined) {
    return { status: 202, body: null }; // A notification: nothing to answer.
  }
  if (!isId(id)) {
    return failure(null, JSONRPC_INVALID_REQUEST, '"id" must be a string or a number', 400);
  }
  const params = message.params;
  if (params !== undefined && !isObject(params)) {
    return failure(id, JSONRPC_INVALID_PARAMS, '"params" must be an object');
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion;
        if (typeof requested !== "string") {
          return failure(id, JSONRPC_INVALID_PARAMS, '"protocolVersion" must be a string');
        }
        return success(id, {
          protocolVersion: negotiateVersion(requested),
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return success(id, {});
      case "tools/list":
        return success(id, { tools: host.list() });
      case "tools/call": {
        const name = params?.name;
        if (typeof name !== "string" || name === "") {
          return failure(id, JSONRPC_INVALID_PARAMS, '"name" must be the name of a tool');
        }
        return success(id, await host.call(name, params?.arguments));
      }
      default:
        return failure(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (e) {
    if (e instanceof RpcError) {
      return failure(id, e.code, e.message);
    }
    // A server-side failure the caller is meant to hear about, such as a database not configured.
    if (e instanceof HttpError) {
      return failure(id, JSONRPC_INTERNAL_ERROR, e.message, e.status);
    }
    // Operational signal for the server log: the caller only learns that something went wrong.
    // eslint-disable-next-line no-console
    console.error(e);
    return failure(id, JSONRPC_INTERNAL_ERROR, "Internal error", 500);
  }
}
