import React from "react";
import { useFirmObservations } from "@/data/firmObservations";
import { useOsdkAction } from "@/data/hooks";
import { runAgentEnrichmentAction } from "@/data/ontology";
import { Button, Skeleton } from "@/ui";
import { AGENT, PROVIDER_TRUST, providerLabel } from "../../../shared/vocab";
import styles from "./AgentRunStrip.module.css";
import { type FirmView, formatActionError } from "./deskModel";
import { agoText } from "./queueState";

const RERUN_HINT = "Re-query sources and propose fresh findings for unresolved axes";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The agent's last run on this firm in one row: when it ran and, per source, how many axes that
 * source supplied a grounded value for and what share of the axes that is. A firm the agent has
 * not run on gets the call to action instead. "Re-run" stays available once it has.
 */
export function AgentRunStrip({
  firm,
  actionFirm,
}: {
  firm: FirmView;
  actionFirm: unknown;
}): React.ReactElement {
  const enrichedAt = (firm as { enrichedAt?: string | null }).enrichedAt ?? null;
  const enrichedBy = (firm as { enrichedBy?: string | null }).enrichedBy ?? null;
  const when = agoText(enrichedAt, Date.now());
  const ran = enrichedAt !== null && when !== null;
  const byAgent = enrichedBy === AGENT;

  const { data, isLoading, error } = useFirmObservations(firm.firmId);
  const runAgent = useOsdkAction(runAgentEnrichmentAction);
  const run = (): void => void runAgent.applyAction({ firm: actionFirm } as never);

  const axes = data?.axes.length ?? 0;
  const failure =
    runAgent.error === undefined ? null : (
      <div role="alert" className={styles.failure}>
        Agent run failed: {formatActionError(runAgent.error)}
      </div>
    );

  if (!ran) {
    return (
      <>
        <section className={`${styles.strip} ${styles.idle}`} aria-label="Agent run">
          <div className={styles.status}>
            <span className={`${styles.dot} ${styles.dotIdle}`} aria-hidden="true" />
            <div>
              <div className={styles.headline}>No agent run yet</div>
              <div className={styles.sub}>Beacon has not queried sources for this firm.</div>
            </div>
          </div>
          <Button
            variant="primary"
            className={styles.cta}
            disabled={runAgent.isPending}
            onClick={run}
            title="Query every source and propose findings for each axis"
          >
            {runAgent.isPending ? "Running…" : "Run agent"}
          </Button>
        </section>
        {failure}
      </>
    );
  }

  return (
    <>
      <section className={styles.strip} aria-label="Agent run">
        <div className={styles.status}>
          <span
            className={`${styles.dot} ${byAgent ? styles.dotLive : styles.dotIdle}`}
            aria-hidden="true"
          />
          <div>
            <div className={styles.headline}>
              {byAgent ? "Agent run complete" : "Enriched by analyst"}
            </div>
            <div className={`${styles.sub} ${styles.mono}`}>
              {when}
              {data !== undefined && ` · ${plural(axes, "axis", "axes")}`}
            </div>
          </div>
        </div>
        {PROVIDER_TRUST.map((provider) => {
          const hits = data?.hitsByProvider[provider] ?? 0;
          const share = axes === 0 ? 0 : Math.min(1, hits / axes);
          const label = providerLabel(provider);
          return (
            <div
              key={provider}
              className={styles.provider}
              title={
                data === undefined
                  ? undefined
                  : `${label} supplied a grounded value for ${hits} of ${plural(axes, "axis", "axes")}`
              }
            >
              <div className={styles.providerRow}>
                <span>{label}</span>
                {data !== undefined && (
                  <span className={`${styles.hits} ${hits === 0 ? styles.hitsNone : ""}`}>
                    {plural(hits, "hit", "hits")}
                  </span>
                )}
              </div>
              {data !== undefined ? (
                <div className={styles.coverage} aria-hidden="true">
                  <i style={{ width: `${share * 100}%` }} />
                </div>
              ) : isLoading ? (
                <Skeleton height={3} />
              ) : (
                <div className={styles.unavailable}>{error ? "Unavailable" : ""}</div>
              )}
            </div>
          );
        })}
        <div className={styles.rerun}>
          <Button variant="ghost" disabled={runAgent.isPending} onClick={run} title={RERUN_HINT}>
            {runAgent.isPending ? "Running…" : "Re-run"}
          </Button>
        </div>
      </section>
      {failure}
    </>
  );
}
