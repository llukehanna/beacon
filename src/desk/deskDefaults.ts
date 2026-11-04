/**
 * Which firm the desk opens on when the URL names none: the first firm in queue order that has
 * an agent run waiting for the analyst, so the demo lands on cited findings, not an empty panel.
 */
export function defaultDeskFirmId(
  queueIds: readonly string[],
  openAgentFirmIds: ReadonlySet<string>,
): string | undefined {
  return queueIds.find((id) => openAgentFirmIds.has(id));
}

interface OpenRunFinding {
  firmId?: string | null;
  provider?: string | null;
}

/** Firm ids with at least one agent finding (analyst entries are not agent runs). */
export function openAgentFirmIds(findings: readonly OpenRunFinding[]): Set<string> {
  const ids = new Set<string>();
  for (const f of findings) {
    if (f.firmId && f.provider !== "analyst") {
      ids.add(f.firmId);
    }
  }
  return ids;
}
