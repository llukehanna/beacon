import React from "react";
import { ExternalLink } from "@/about/DocLayout";
import { ARCHITECTURE_DOC_URL, RECORDED_RUN } from "@/about/facts";
import { errorMessage } from "@/data/adapter";
import { SectionHead } from "@/home/SectionHead";
import { EmptyState, Notice, Panel, Skeleton } from "@/ui";
import { P95_MIN_RUNS, usd, windowLabel } from "../../shared/operations";
import type { DaySpend, OperationsSummary } from "../../shared/summaries";
import styles from "./OperationsPanel.module.css";
import { evalCount } from "./evalsModel";

/** Latency in milliseconds, or seconds once it passes one. */
const ms = (value: number): string =>
  value < 1000 ? `${evalCount(value)} ms` : `${(value / 1000).toFixed(1)} s`;

function LatencyTable({ data }: { data: OperationsSummary }): React.ReactElement {
  return (
    <Panel className={styles.panel} aria-label="Action latency">
      <SectionHead title="Action latency" count={data.actions.length} />
      {data.actions.length === 0 ? (
        <p className={styles.none}>No actions have run in this window.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.first}>
                  Action
                </th>
                <th scope="col">Runs</th>
                <th scope="col">p50</th>
                <th scope="col">p95</th>
                <th scope="col">Errors</th>
              </tr>
            </thead>
            <tbody>
              {data.actions.map((a) => (
                <tr key={a.actionName}>
                  <th scope="row" className={styles.label}>
                    {a.actionName}
                  </th>
                  <td className={styles.num}>{evalCount(a.count)}</td>
                  <td className={styles.num}>{ms(a.p50Ms)}</td>
                  <td className={styles.num}>
                    {ms(a.p95Ms)}
                    {a.count < P95_MIN_RUNS && "*"}
                  </td>
                  <td className={styles.num} data-errors={a.errors > 0 || undefined}>
                    {evalCount(a.errors)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.caption}>
        Wall-clock time for each action, from the request reaching the action to its result,
        including the database transaction. p50 is the middle run and p95 the slowest one in twenty;
        with fewer than {P95_MIN_RUNS} runs (marked *) p95 is simply the slowest run.
        clusterRejections includes its Claude call when Claude clustering is switched on. Errors are
        actions that were refused or failed.
      </p>
    </Panel>
  );
}

function SpendTable({ data }: { data: OperationsSummary }): React.ReactElement {
  const rows: readonly DaySpend[] = data.spend;
  return (
    <Panel className={styles.panel} aria-label="Model spend">
      <SectionHead title="Live model spend" count={rows.length} />
      {rows.length === 0 ? (
        <p className={styles.none}>No live Claude calls in this window.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.first}>
                  Day (UTC)
                </th>
                <th scope="col">Calls</th>
                <th scope="col">Tokens in / out</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.day}>
                  <th scope="row" className={styles.label}>
                    {d.day}
                  </th>
                  <td className={styles.num}>
                    {d.calls} of {data.dailyCallCap}
                  </td>
                  <td className={styles.num}>
                    {evalCount(d.inputTokens)} / {evalCount(d.outputTokens)}
                  </td>
                  <td className={styles.num}>{usd(d.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.caption}>
        Live Claude calls only: token counts come from the API response and cost from this
        repository&rsquo;s price table; a call answered by a model with no listed price is priced at
        claude-opus-5 rates, so its cost is then an estimate. The cap is {data.dailyCallCap} calls
        per UTC day. Claude clustering is off unless it is switched on, so an empty table is the
        normal state of the public demo.
      </p>
    </Panel>
  );
}

/**
 * Operations: how long each action takes and what live model calls cost, measured by the running
 * app since the last reset (a reset clears them, so the window is stated, not implied).
 */
export function OperationsPanel({
  data,
  isLoading,
  error,
}: {
  data: OperationsSummary | undefined;
  isLoading: boolean;
  error: Error | undefined;
}): React.ReactElement {
  if (error !== undefined) {
    return <Notice>{errorMessage(error)}</Notice>;
  }
  if (data === undefined) {
    return isLoading ? (
      <Panel aria-busy="true">
        <Skeleton lines={4} />
      </Panel>
    ) : (
      <EmptyState title="No operations data" body="The operations summary did not load." />
    );
  }
  return (
    <div className={styles.root}>
      <p className={styles.banner}>
        <b>Measured by this app, {windowLabel(data.windowStart)}.</b> Resetting the demo clears
        these figures, so they cover only what has run since.
      </p>
      <div className={styles.grid}>
        <LatencyTable data={data} />
        <SpendTable data={data} />
      </div>
      <p className={styles.note}>
        <b>Not counted here.</b> The recorded offline extraction run (
        {evalCount(RECORDED_RUN.firms)} firms, {RECORDED_RUN.model}) cost{" "}
        {RECORDED_RUN.extractionCost}, and its clustering step {RECORDED_RUN.clusteringCost}; it ran
        once, offline, and is described in{" "}
        <ExternalLink href={ARCHITECTURE_DOC_URL}>docs/architecture.md</ExternalLink>. The seeded
        history built at reset is not counted either.
      </p>
    </div>
  );
}
