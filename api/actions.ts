import { resolveAccess } from "../server/access.js";
import { applyAction } from "../server/actions/apply.js";
import { getDb } from "../server/db/client.js";
import { HttpError } from "../server/errors.js";
import { json, jsonError, readBody } from "../server/http.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readBody(request);
    if (typeof body.action !== "string") {
      throw new HttpError("Expected { action: string, params: object }");
    }
    const db = await getDb();
    const access = await resolveAccess(request, db);
    return json(await applyAction(db, body.action, body.params ?? {}, { access }));
  } catch (e) {
    return jsonError(e);
  }
}
