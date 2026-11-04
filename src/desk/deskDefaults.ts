/**
 * Which firm the desk opens on when the URL names none: the first firm in queue order with an
 * agent run waiting for the analyst, so the demo lands on cited findings, not an empty panel.
 */
export function defaultDeskFirmId(
  queueIds: readonly string[],
  openAgentFirmIds: ReadonlySet<string>,
): string | undefined {
  return queueIds.find((id) => openAgentFirmIds.has(id));
}

interface FirmLike {
  firmId?: string | null;
  enrichedBy?: string | null;
}

/** Firm ids whose agent run is open: the agent touched the firm and no analyst has since. */
export function agentRunFirmIds(firms: readonly FirmLike[], agent: string): Set<string> {
  const ids = new Set<string>();
  for (const f of firms) {
    if (f.firmId && f.enrichedBy === agent) {
      ids.add(f.firmId);
    }
  }
  return ids;
}
