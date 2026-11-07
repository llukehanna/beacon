/**
 * The mock source document one provider holds for one firm: what the source drawer shows
 * behind a cited finding. Rendered on demand from the firm; nothing is stored.
 */
import { PROVIDER_TRUST, type Provider } from "../../shared/vocab.js";
import { type Access, isHidden } from "../access.js";
import type { Queryable } from "../db/client.js";
import { getObject } from "../db/repo.js";
import { HttpError } from "../errors.js";
import { type SourceDocument, sourceDocument as renderDocument } from "../extraction/documents.js";

const isProvider = (v: unknown): v is Provider =>
  typeof v === "string" && (PROVIDER_TRUST as readonly string[]).includes(v);

export async function sourceDocument(
  q: Queryable,
  params: Record<string, unknown>,
  access: Access,
): Promise<SourceDocument> {
  const { firmId, provider } = params;
  if (typeof firmId !== "string" || firmId === "" || !isProvider(provider)) {
    throw new HttpError("Unknown source document", 404);
  }
  const firm = await getObject(q, "Firm", firmId);
  // A firm the persona may not see is as absent as one that does not exist.
  if (firm === null || isHidden(access, "Firm", firm)) {
    throw new HttpError(`Firm ${firmId} not found`, 404);
  }
  return renderDocument(provider, firm);
}
