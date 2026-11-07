import { logAccess, resolveAccess } from "../server/access.js";
import { getDb } from "../server/db/client.js";
import { HttpError } from "../server/errors.js";
import { runFunction } from "../server/functions/index.js";
import { json, jsonError, jsonParam } from "../server/http.js";

/** Functions that open one firm in detail: running one is viewing the firm. */
const FIRM_VIEWS = new Set(["firmObservations", "sourceDocument"]);

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "";
    const params = jsonParam(url, "params") ?? {};
    if (params === null || typeof params !== "object" || Array.isArray(params)) {
      throw new HttpError('Query parameter "params" must be a JSON object');
    }
    const db = await getDb();
    const access = await resolveAccess(request, db);
    const value = await runFunction(db, name, params as Record<string, unknown>, access);
    // Reached only when the firm exists for this persona (a hidden one throws above).
    const firmId = (params as { firmId?: unknown }).firmId;
    if (FIRM_VIEWS.has(name) && typeof firmId === "string") {
      await logAccess(db, access, "Firm", firmId);
    }
    return json({ value });
  } catch (e) {
    return jsonError(e);
  }
}
