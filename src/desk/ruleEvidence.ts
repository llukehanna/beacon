// Pure: turns a rule's supportingDecisionIds into the analysts' rejection
// notes (quote, firm, date) shown when "Based on N rejections" is expanded.

export interface EvidenceDecision {
  decisionId: string;
  firmId?: string;
  rejectionRationale?: string | null;
  decidedAt?: unknown;
}

export interface RejectionNote {
  decisionId: string;
  note: string;
  firmName: string;
  /** Epoch ms, or null when the decision has no usable date. */
  decidedAtMs: number | null;
}

function toMs(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Decisions without a written rationale are dropped (nothing to quote).
 * Newest first; undated notes sort last. A decision whose firm is not on
 * file is kept with firmName "Firm not on file".
 */
export function buildRejectionNotes(
  supportingIds: readonly string[],
  decisionsById: ReadonlyMap<string, EvidenceDecision>,
  firmNameById: ReadonlyMap<string, string>,
): RejectionNote[] {
  const seen = new Set<string>();
  const notes: RejectionNote[] = [];
  for (const id of supportingIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const d = decisionsById.get(id);
    const note = d?.rejectionRationale?.trim() ?? "";
    if (d === undefined || note === "") {
      continue;
    }
    notes.push({
      decisionId: id,
      note,
      firmName:
        (d.firmId !== undefined ? firmNameById.get(d.firmId) : undefined) ?? "Firm not on file",
      decidedAtMs: toMs(d.decidedAt),
    });
  }
  return notes.sort((a, b) => (b.decidedAtMs ?? -Infinity) - (a.decidedAtMs ?? -Infinity));
}
