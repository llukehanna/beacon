import React from "react";
import { useSearchParams } from "react-router-dom";
import { Term } from "@/components/Term";
import { useOsdkQuery } from "@/data/hooks";
import { Chip, EmptyState, Metric, Notice, PageHeader, Panel, Skeleton } from "@/ui";
import evalReportJson from "../../docs/evals.json";
import type { EvalReport } from "../../shared/evalReport";
import type { AccuracySummary } from "../../shared/summaries";
import { INSUFFICIENT_THRESHOLD } from "../../shared/trustMetrics";
import styles from "./AccuracyPage.module.css";
import { BreakdownTable } from "./BreakdownTable";
import { EvalsPanel } from "./EvalsPanel";
import { OutcomesPanel } from "./OutcomesPanel";
import { type AccuracyTab, tabFromParam } from "./evalsModel";

/** Written by `npm run eval` and bundled at build time; `server/eval` checks it is current in CI. */
const EVAL_REPORT = evalReportJson as unknown as EvalReport;

const TABS: readonly { id: AccuracyTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "evals", label: "Evals" },
];

const count = (n: number) => n.toLocaleString("en-US");

/** The four headline rates; none has a trend, because the summary carries no history to draw. */
function Headline({ data }: { data: AccuracySummary }): React.ReactElement {
  const { overall } = data;
  return (
    <div className={styles.metrics}>
      <Metric
        highlighted
        label="Analyst agreement"
        aside={`${count(overall.decided)} decided`}
        value={overall.agreement ?? "—"}
        unit={overall.agreement === null ? undefined : "%"}
        meaning="of decided findings, analysts kept what the agent proposed"
        tone="accent"
      />
      <Metric
        label="Override rate"
        value={overall.override ?? "—"}
        unit={overall.override === null ? undefined : "%"}
        meaning="of decided findings, analysts replaced what the agent proposed"
        tone="muted"
      />
      <Metric
        label={<Term id="Abstention">Abstention</Term>}
        aside={`${count(overall.total)} findings`}
        value={overall.abstention}
        unit="%"
        meaning="of all findings, no source had it, so Beacon said so"
        tone="muted"
      />
      <Metric
        label="Decided findings"
        value={count(overall.decided)}
        meaning="accepted or rejected by an analyst; abstains excluded"
      />
    </div>
  );
}

/** The overview: analyst agreement, outcomes and the by-provider and by-axis tables. */
function Overview({
  data,
  isLoading,
}: {
  data: AccuracySummary | undefined;
  isLoading: boolean;
}): React.ReactElement {
  const insufficient = data !== undefined && data.overall.decided < INSUFFICIENT_THRESHOLD;
  return (
    <>
      {data === undefined && isLoading && (
        <div className={styles.metrics} aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i} className={styles.loading}>
              <Skeleton lines={3} />
            </Panel>
          ))}
        </div>
      )}

      {insufficient && (
        <EmptyState
          title={`Trust metrics appear after ${INSUFFICIENT_THRESHOLD} decided findings`}
          body={`Beacon needs a baseline of agent-vs-analyst decisions before agreement, override, and abstention rates are meaningful. ${data?.overall.decided} decided so far. Keep reviewing.`}
        />
      )}

      {data !== undefined && !insufficient && (
        <>
          <Headline data={data} />
          <OutcomesPanel tally={data.outcomes} />
          <div className={styles.tables}>
            <BreakdownTable
              title="By provider"
              groupLabel="Provider"
              rows={data.byProvider.map((p) => ({
                key: p.key,
                label: <Chip>{p.label}</Chip>,
                r: p.r,
              }))}
            />
            <BreakdownTable
              title="By axis"
              groupLabel="Axis"
              rows={data.byAxis.map((a) => ({ key: a.key, label: a.label, r: a.r }))}
            />
          </div>
          <p className={styles.footnote}>
            <b>Of decided</b> = the agent proposed a value and you either accepted (agreement) or
            rejected it (override); abstains excluded. <b>Of all findings</b> = every finding the
            agent produced for this group, abstains included, so the columns don&rsquo;t sum to
            100%. <b>Abstention</b> = no value recorded because no source stated one, or the stated
            value had no supporting quote.
          </p>
        </>
      )}
    </>
  );
}

/**
 * Accuracy: how often Beacon agreed with the analyst, was overridden or honestly abstained, in
 * total and by provider and axis, and what happened to the firms in the end (Overview); and how
 * the agent does against a generated universe with known true values (Evals). Rates appear once
 * enough findings have been decided for them to mean something. The tab is in the URL.
 */
export default function AccuracyPage(): React.ReactElement {
  // Aggregated on the server: a few kilobytes of rates instead of every finding and firm.
  const { data, isLoading, error } = useOsdkQuery<AccuracySummary>("accuracySummary");
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  const select = (next: AccuracyTab): void => {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === "overview") {
          out.delete("tab");
        } else {
          out.set("tab", next);
        }
        return out;
      },
      { replace: true },
    );
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) {
      return;
    }
    e.preventDefault();
    const at = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length].id;
    select(next);
    document.getElementById(`accuracy-tab-${next}`)?.focus();
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Trust metrics"
        sub={
          tab === "evals"
            ? "How the agent does against a generated universe whose true values are known"
            : isLoading
              ? "Loading findings…"
              : "How often Beacon agreed with you, was overridden, or honestly abstained"
        }
      />
      <div className={styles.tabs} role="tablist" aria-label="Trust metrics views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`accuracy-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="accuracy-tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            className={styles.tab}
            onClick={() => select(t.id)}
            onKeyDown={onKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && error !== undefined && error !== null && (
        <Notice className={styles.error}>{String(error)}</Notice>
      )}

      <div
        className={styles.scroll}
        id="accuracy-tabpanel"
        role="tabpanel"
        aria-labelledby={`accuracy-tab-${tab}`}
      >
        {tab === "evals" ? (
          <EvalsPanel report={EVAL_REPORT} />
        ) : (
          <Overview data={data} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}
