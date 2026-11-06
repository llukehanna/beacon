import { ANALYST } from "../../../shared/vocab";

/**
 * Whether the agent has run on a firm, read from what it left behind: a finding from any source
 * other than the analyst. A firm's `enrichedAt` is not evidence of a run, because an analyst
 * committing values by hand sets it too; provider readings (hit counts, grid cells) are only real
 * once the agent has produced findings.
 */
export function agentHasRun(findings: readonly { provider?: string | null }[]): boolean {
  return findings.some((f) => (f.provider ?? "").trim() !== "" && f.provider !== ANALYST);
}
