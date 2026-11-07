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

/**
 * Where the desk goes after the analyst passes on a firm: the firm after it in the live queue, or,
 * when it was last, the first one still there. Undefined when the passed firm was the only one.
 */
export function nextQueueFirmId(
  liveQueueIds: readonly string[],
  passedId: string,
): string | undefined {
  const at = liveQueueIds.indexOf(passedId);
  const after = at === -1 ? undefined : liveQueueIds.slice(at + 1).find((id) => id !== passedId);
  return after ?? liveQueueIds.find((id) => id !== passedId);
}

/**
 * The firm to open when a pass lands: the next one in the list the analyst can see, but only if
 * they are still on the firm they passed. Someone who opened another firm while the pass was
 * saving has moved on and is left where they are.
 */
export function nextAfterPass(
  visibleIds: readonly string[],
  passedId: string,
  currentId: string | undefined,
): string | undefined {
  return currentId === passedId ? nextQueueFirmId(visibleIds, passedId) : undefined;
}
