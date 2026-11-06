import { Link } from "react-router-dom";
import { Metric, Panel, Skeleton } from "@/ui";
import type { HomeSummary } from "../../shared/summaries";
import type { Trend } from "../../shared/trends";
import { INSUFFICIENT_THRESHOLD } from "../../shared/trustMetrics";
import styles from "./MetricRow.module.css";
import { sharePercent } from "./share";

const count = (n: number) => n.toLocaleString("en-US");

/** A trend as the card draws it. */
const asTrend = (t: Trend | null) =>
  t === null ? null : { points: t.points.map((p) => p.value), delta: t.delta };

const daysOf = (t: Trend | null) => (t === null ? undefined : `${t.points.length} days`);

function Card({ to, label, children }: { to: string; label: string; children: React.ReactNode }) {
  return (
    <Link to={to} className={styles.card} aria-label={label}>
      {children}
    </Link>
  );
}

/** The four headline numbers, each linking to the page that holds the work behind it. */
export function MetricRow({ data }: { data: HomeSummary | undefined }) {
  if (data === undefined) {
    return (
      <div className={styles.row} aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Panel key={i} className={styles.loading}>
            <Skeleton lines={3} />
          </Panel>
        ))}
      </div>
    );
  }

  const { grounded, trust, trends, funnel, mandates } = data;
  const firms = Object.values(funnel).reduce((a, b) => a + b, 0);
  const open = funnel.Discovered + funnel.Screening;
  const agreementReady = trust.decidedFindings >= INSUFFICIENT_THRESHOLD;

  return (
    <div className={styles.row}>
      <Card to="/accuracy" label="Grounded in a source: open accuracy">
        <Metric
          highlighted
          label="Grounded in a source"
          aside={daysOf(trends.grounded)}
          value={
            grounded.agentValues === 0 ? "—" : sharePercent(grounded.cited, grounded.agentValues)
          }
          unit={grounded.agentValues === 0 ? undefined : "%"}
          meaning={
            grounded.agentValues === 0
              ? "No agent values yet"
              : `${count(grounded.cited)} of ${count(grounded.agentValues)} agent values cite a verbatim quote`
          }
          trend={asTrend(trends.grounded)}
          tone="accent"
        />
      </Card>
      <Card to="/accuracy" label="Honest abstention: open accuracy">
        <Metric
          label="Honest abstention"
          aside={daysOf(trends.abstention)}
          value={trust.abstentionRate}
          unit="%"
          meaning="no source had it, so Beacon said so"
          trend={asTrend(trends.abstention)}
          tone="muted"
          hideDelta
        />
      </Card>
      <Card to="/accuracy" label="Analyst agreement: open accuracy">
        <Metric
          label="Analyst agreement"
          aside={`${count(trust.decidedFindings)} decided`}
          value={agreementReady && trust.agreementRate !== null ? trust.agreementRate : "—"}
          unit={agreementReady && trust.agreementRate !== null ? "%" : undefined}
          meaning={
            agreementReady
              ? "analysts kept what the agent proposed"
              : `shows after ${INSUFFICIENT_THRESHOLD} decided findings`
          }
          trend={agreementReady ? asTrend(trends.agreement) : null}
          tone="green"
        />
      </Card>
      <Card to="/pipeline" label="Firms in coverage: open pipeline">
        <Metric
          label="Firms in coverage"
          aside={`${count(mandates.length)} mandate${mandates.length === 1 ? "" : "s"}`}
          value={count(firms)}
          meaning={`${count(open)} open · ${count(funnel.Passed)} passed`}
        />
      </Card>
    </div>
  );
}
