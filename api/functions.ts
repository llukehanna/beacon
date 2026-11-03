import { getDb } from "../server/db/client.js";
import { HttpError } from "../server/errors.js";
import { runFunction } from "../server/functions/index.js";
import { json, jsonError, jsonParam } from "../server/http.js";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "";
    const params = jsonParam(url, "params") ?? {};
    if (params === null || typeof params !== "object" || Array.isArray(params)) {
      throw new HttpError('Query parameter "params" must be a JSON object');
    }
    return json({
      value: await runFunction(await getDb(), name, params as Record<string, unknown>),
    });
  } catch (e) {
    return jsonError(e);
  }
}
