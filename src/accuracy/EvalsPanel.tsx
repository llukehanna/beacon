import React from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "@/about/DocLayout";
import { ERROR_ANALYSIS_DOC_URL, EVALS_DOC_URL } from "@/about/facts";
import { useOsdkObjects } from "@/data/hooks";
import { Firm } from "@/data/ontology";
import { SectionHead } from "@/home/SectionHead";
import { Chip, Metric, Panel } from "@/ui";
import { axisLabel } from "../../shared/axisLabels";
import { type EvalReport, FAILURE_TEXT } from "../../shared/evalReport";
import { providerLabel } from "../../shared/vocab";
import styles from "./EvalsPanel.module.css";
import { deskHref, evalCount, evalPct, exampleFirmName, tierFraming } from "./evalsModel";

const GROUND_TRUTH = "Against synthetic ground truth";

/** The four headline measures. Each is a share of the evaluated axes or firms, in percent. */
function Headline({ report }: { report: EvalReport }): React.ReactElement {
  const { reconciled, abstention } = report;
  const unit = (rate: number | null): string | undefined => (rate === null ? undefined : "%");
  return (
    <div className={styles.metrics}>
      <Metric
        highlighted
        label="Reconciled precision"
        aside="synthetic truth"
        value={evalPct(reconciled.precision)}
        unit={unit(reconciled.precision)}
        meaning="of the values the agent settled on match the true value"
        tone="accent"
      />
      <Metric
        label="Coverage"
        aside="synthetic truth"
        value={evalPct(reconciled.coverage)}
        unit={unit(reconciled.coverage)}
        meaning="of firm axes the agent settled on one value"
        tone="muted"
      />
      <Metric
        label="Abstention calibration"
        aside="synthetic truth"
        value={evalPct(abstention.calibration)}
        unit={unit(abstention.calibration)}
        meaning="of abstentions were right: no source stated the value"
        tone="muted"
      />
      <Metric
        label="Tier agreement"
        aside="synthetic truth"
        value={evalPct(report.tierAgreement)}
        unit={unit(report.tierAgreement)}
        meaning="of firms get the true tier from settled values, before an analyst finishes"
        tone="muted"
      />
    </div>
  );
}

function ProviderTable({ report }: { report: EvalReport }): React.ReactElement {
  return (
    <Panel className={styles.panel} aria-label="Providers against ground truth">
      <SectionHead title="By provider" count={report.providers.length} />
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.first}>
              Provider
            </th>
            <th scope="col">Coverage</th>
            <th scope="col">Precision</th>
          </tr>
        </thead>
        <tbody>
          {report.providers.map((p) => (
            <tr key={p.provider}>
              <th scope="row" className={styles.label}>
                <Chip>{providerLabel(p.provider)}</Chip>
              </th>
              <td className={styles.rate}>{evalPct(p.coverage)}%</td>
              <td className={styles.rate}>{evalPct(p.precision)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.caption}>
        {GROUND_TRUTH}. Coverage is the share of axes a provider covers where it gave a quotable
        reading. Precision is the share of those readings that match the true value.
      </p>
    </Panel>
  );
}

function Taxonomy({ report }: { report: EvalReport }): React.ReactElement {
  const { slots, failures } = report;
  // The examples carry firm ids; the firms are read to show their names, and each links to its Desk.
  const firms = useOsdkObjects(Firm, { autoFetchMore: true });
  const names = React.useMemo(
    () =>
      firms.data === undefined
        ? undefined
        : new Map(firms.data.map((f) => [f.firmId ?? "", f.firmName ?? ""] as const)),
    [firms.data],
  );
  return (
    <Panel className={styles.panel} aria-label="Failure taxonomy">
      <SectionHead title="Failure taxonomy" />
      <p className={styles.lead}>
        {GROUND_TRUTH}. Of {evalCount(slots.total)} firm axes, {evalCount(slots.correct)} end with
        the true value settled. The other {evalCount(slots.total - slots.correct)} fall into one of
        four kinds.
      </p>
      <ul className={styles.kinds}>
        {failures.map((f) => (
          <li key={f.kind} className={styles.kind} data-kind={f.kind}>
            <div className={styles.kindHead}>
              <span className={styles.kindName}>{FAILURE_TEXT[f.kind].label}</span>
              <span className={styles.kindCount}>
                {evalCount(f.count)}{" "}
                <small>{evalPct(slots.total === 0 ? null : f.count / slots.total)}%</small>
              </span>
            </div>
            <p className={styles.meaning}>{FAILURE_TEXT[f.kind].meaning}</p>
            {f.examples.length > 0 && (
              <ul
                className={styles.examples}
                aria-label={`Examples: ${FAILURE_TEXT[f.kind].label}`}
              >
                {f.examples.map((e) => (
                  <li key={`${e.firmId}:${e.axis}`}>
                    <Link className={styles.example} to={deskHref(e.firmId)}>
                      <span className={styles.exampleAxis}>{axisLabel(e.axis)}</span>
                      <span className={styles.exampleFirm}>{exampleFirmName(e.firmId, names)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * The evaluation report: how the agent does against a generated universe whose true values are
 * known. Every figure is read from `docs/evals.json`, which `npm run eval` writes.
 */
export function EvalsPanel({ report }: { report: EvalReport }): React.ReactElement {
  return (
    <div className={styles.root}>
      <p className={styles.banner}>
        <b>{GROUND_TRUTH}.</b> {evalCount(report.firms)} generated firms, extraction read from{" "}
        {report.generatedFrom.fixtures}. None of these figures says how Beacon would do on real
        firms.
      </p>
      <Headline report={report} />
      <p className={styles.framing}>{tierFraming(report)}</p>
      <div className={styles.grid}>
        <ProviderTable report={report} />
        <Taxonomy report={report} />
      </div>
      <p className={styles.note}>
        <b>How this is measured.</b> The agent reads each firm&rsquo;s source records, keeps only
        values it can quote, reconciles them and scores the firm. The universe is generated, so
        every axis has a hidden true value to check against. Rule recovery: the clusterer found{" "}
        {report.ruleRecovery.recovered} of {report.ruleRecovery.planted} planted rejection patterns.
        Definitions, thresholds and limits are in{" "}
        <ExternalLink href={EVALS_DOC_URL}>docs/evals.md</ExternalLink>; what each failure kind
        means for the analyst is in{" "}
        <ExternalLink href={ERROR_ANALYSIS_DOC_URL}>docs/error-analysis.md</ExternalLink>. Run{" "}
        <code>npm run eval</code> to reproduce.
      </p>
    </div>
  );
}
