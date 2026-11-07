import React from "react";
import { RECORDED_RUN_NOTE } from "@/about/facts";
import { errorMessage } from "@/data/adapter";
import { useFirmObservations } from "@/data/firmObservations";
import { useOsdkAction } from "@/data/hooks";
import { runAgentEnrichmentAction } from "@/data/ontology";
import { type Command, useCommands } from "@/shell/commands";
import { Button, Skeleton } from "@/ui";
import { AGENT, PROVIDER_TRUST, providerLabel } from "../../../shared/vocab";
import styles from "./AgentRunStrip.module.css";
import { type FirmView } from "./deskModel";
import { agoText } from "./queueState";

const RERUN_HINT =
  "Reads the recorded source records for this firm again and proposes fresh findings for the axes still open. It replays the recorded extraction; no model is called.";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The agent's last run on this firm in one row: when it ran and, per source, how many axes that
 * source supplied a grounded value for and what share of the axes that is. A firm the agent has
 * not run on gets the call to action instead. "Replay run" stays available once it has.
 *
 * `agentRan` comes from the firm's findings (see `agentHasRun`), not from `enrichedAt`: an analyst
 * committing values by hand stamps the firm too, and that is not a run. It is undefined while the
 * findings load.
 */
export function AgentRunStrip({
  firm,
  firmId,
  agentRan,
}: {
  firm: FirmView;
  firmId: string;
  agentRan: boolean | undefined;
}): React.ReactElement {
  const enrichedAt = firm.enrichedAt ?? null;
  const enrichedBy = firm.enrichedBy ?? null;
  const when = agoText(enrichedAt, Date.now());
  const ran = agentRan === true;
  const byAgent = enrichedBy === AGENT;

  const { data, isLoading, error } = useFirmObservations(ran ? firm.firmId : undefined);
  const runAgent = useOsdkAction(runAgentEnrichmentAction);
  const run = (): void => {
    if (!runAgent.isPending) {
      // A failure is shown below through runAgent.error.
      void runAgent.applyAction({ firm: firmId }).catch(() => undefined);
    }
  };

  // "Run agent" in the command palette, for the firm on screen. The ref keeps the registered
  // command pointing at the current firm without re-registering on every render.
  const runRef = React.useRef(run);
  runRef.current = run;
  const commands = React.useMemo<Command[]>(
    () => [
      {
        id: "desk:run-agent",
        label: ran ? "Replay agent run on this firm" : "Run agent on this firm",
        group: "Actions",
        run: () => runRef.current(),
      },
    ],
    [ran],
  );
  useCommands(commands);

  const axes = data?.axes.length ?? 0;
  const failure =
    runAgent.error === undefined ? null : (
      <div role="alert" className={styles.failure}>
        Agent run failed: {errorMessage(runAgent.error)}
      </div>
    );

  if (agentRan === undefined) {
    return (
      <section className={styles.strip} aria-label="Agent run" aria-busy="true">
        <Skeleton height={36} />
      </section>
    );
  }

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
              {byAgent ? "Recorded run, replayed" : "Enriched by analyst"}
            </div>
            <div className={`${styles.sub} ${styles.mono}`}>
              {when}
              {data !== undefined &&
                `${when === null ? "" : " · "}${plural(axes, "field", "fields")}`}
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
                  : `${label} supplied a grounded value for ${hits} of ${plural(axes, "field", "fields")}`
              }
            >
              <div className={styles.providerRow}>
                <span>{label}</span>
                {data !== undefined && (
                  <span className={styles.hits}>{plural(hits, "hit", "hits")}</span>
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
            {runAgent.isPending ? "Running…" : "Replay run"}
          </Button>
        </div>
      </section>
      <p className={styles.replay}>{RECORDED_RUN_NOTE}</p>
      {failure}
    </>
  );
}
