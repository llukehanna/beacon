import React from "react";
import { Link, useParams } from "react-router-dom";
import { useOsdkObjects } from "@/data/hooks";
import { Firm, ResearchFinding, ReviewDecision } from "@/data/ontology";
import { type FirmView } from "@/desk/firmDesk/deskModel";
import { useScreeningRules } from "@/desk/firmDesk/useScreeningRules";
import { type Command, useCommands } from "@/shell/commands";
import { Button, ButtonLink, EmptyState, Notice, Panel, Skeleton } from "@/ui";
import { type FindingLike } from "../desk/axisState";
import { formatScore } from "../desk/scoreFormat";
import styles from "./TearSheetPage.module.css";
import {
  type AbstentionItem,
  type Citation,
  type ConflictItem,
  type DecisionInput,
  type EvidenceItem,
  type TearSheet,
  buildTearSheet,
} from "./tearSheetModel";

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Marks the document while the sheet is on screen, so the print rules hide the shell. */
function usePrintMode(): void {
  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset.print = "tear-sheet";
    return () => {
      delete root.dataset.print;
    };
  }, []);
}

function CitationLine({ c }: { c: Citation }): React.ReactElement {
  if (c.quote === null) {
    return (
      <p className={styles.source}>
        {c.provider === "Analyst"
          ? "Entered by an analyst. No source document."
          : `${c.provider}. No source sentence is on file.`}
      </p>
    );
  }
  return (
    <>
      <blockquote className={styles.quote}>{c.quote}</blockquote>
      <p className={styles.source}>
        Source: {c.provider}
        {c.model !== null && <> · Read by {c.model}</>}
      </p>
    </>
  );
}

function Evidence({ items }: { items: EvidenceItem[] }): React.ReactElement {
  if (items.length === 0) {
    return <p className={styles.plain}>No value on this firm is backed by a cited source yet.</p>;
  }
  return (
    <ul className={styles.list}>
      {items.map((e) => (
        <li key={e.axis} className={styles.item}>
          <p className={styles.itemHead}>
            <span className={styles.axis}>{e.axis}</span>
            <span className={styles.value}>{e.value}</span>
            <span className={styles.tag}>
              {e.status === "verified" ? "Verified by an analyst" : "Proposed, not yet verified"}
            </span>
          </p>
          <CitationLine c={e} />
        </li>
      ))}
    </ul>
  );
}

function Conflicts({ items }: { items: ConflictItem[] }): React.ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((c) => (
        <li key={c.axis} className={styles.item}>
          <p className={styles.itemHead}>
            <span className={styles.axis}>{c.axis}</span>
            <span className={`${styles.tag} ${styles.warn}`}>Sources disagree, not resolved</span>
          </p>
          <ul className={styles.sides}>
            {c.sides.map((s, i) => (
              <li key={`${s.provider}-${i}`}>
                <p className={styles.itemHead}>
                  <span className={styles.value}>{s.value}</span>
                </p>
                <CitationLine c={s} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Abstentions({ items }: { items: AbstentionItem[] }): React.ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((a) => (
        <li key={a.axis} className={styles.item}>
          <p className={styles.itemHead}>
            <span className={styles.axis}>{a.axis}</span>
            <span className={`${styles.tag} ${styles.warn}`}>Abstained</span>
          </p>
          <p className={styles.plain}>
            No source supported a value, so Beacon did not guess.
            {a.onFile !== null && <> The firm record holds {a.onFile}.</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Sheet({ sheet, today }: { sheet: TearSheet; today: string }): React.ReactElement {
  const { score } = sheet;
  return (
    <article className={styles.sheet} aria-label={`Tear sheet: ${sheet.name}`}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Beacon tear sheet</p>
        <h1 className={styles.title}>{sheet.name}</h1>
        <p className={styles.sub}>
          {sheet.stage} · {score.model === "CS" ? "Capital solutions" : "Corporate finance"} model ·
          Prepared {today}
        </p>
      </header>

      <Panel className={styles.section} aria-labelledby="ts-overview">
        <h2 id="ts-overview" className={styles.heading}>
          Overview
        </h2>
        {sheet.facts.length === 0 ? (
          <p className={styles.plain}>No profile fields are on file for this firm.</p>
        ) : (
          <dl className={styles.facts}>
            {sheet.facts.map((f) => (
              <div key={f.label} className={styles.fact}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>

      <Panel className={styles.section} aria-labelledby="ts-score">
        <h2 id="ts-score" className={styles.heading}>
          Score and tier
        </h2>
        <p className={styles.scoreLine}>
          <span className={styles.big}>{score.total}</span>
          <span className={styles.of}> / {score.max}</span>
          <span className={styles.tier}>{score.tierText}</span>
        </p>
        {score.screenedBecause !== null && (
          <p className={styles.plain}>Screened out: {score.screenedBecause}.</p>
        )}
        {sheet.atDecision !== null && (
          <p className={styles.plain}>
            Score when passed: {formatScore(sheet.atDecision.total, sheet.atDecision.tier)}. The
            score above is the live one.
          </p>
        )}
        {sheet.axes.length === 0 ? (
          <p className={styles.plain}>
            No axis breakdown: a screened firm is not scored axis by axis.
          </p>
        ) : (
          <table className={styles.table}>
            <caption className="sr-only">Score by axis, out of 2 points each</caption>
            <thead>
              <tr>
                <th scope="col">Axis</th>
                <th scope="col">On file</th>
                <th scope="col" className={styles.num}>
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.axes.map((a) => (
                <tr key={a.axis}>
                  <th scope="row">{a.axis}</th>
                  <td>{a.value}</td>
                  <td className={styles.num}>
                    {a.points === null ? "unknown" : `${a.points} / 2`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel className={styles.section} aria-labelledby="ts-evidence">
        <h2 id="ts-evidence" className={styles.heading}>
          Key evidence
        </h2>
        <Evidence items={sheet.evidence} />
      </Panel>

      <Panel className={styles.section} aria-labelledby="ts-open">
        <h2 id="ts-open" className={styles.heading}>
          Open conflicts and abstentions
        </h2>
        {sheet.conflicts.length === 0 && sheet.abstentions.length === 0 ? (
          <p className={styles.plain}>No open conflicts. No abstentions.</p>
        ) : (
          <>
            {sheet.conflicts.length > 0 && <Conflicts items={sheet.conflicts} />}
            {sheet.abstentions.length > 0 && <Abstentions items={sheet.abstentions} />}
          </>
        )}
      </Panel>

      <Panel className={styles.section} aria-labelledby="ts-history">
        <h2 id="ts-history" className={styles.heading}>
          Decision history
        </h2>
        {sheet.decisions.length === 0 ? (
          <p className={styles.plain}>No one has made a decision on this firm yet.</p>
        ) : (
          <ol className={styles.list}>
            {sheet.decisions.map((d) => (
              <li key={d.id || d.at} className={styles.item}>
                <p className={styles.itemHead}>
                  <span className={styles.axis}>{d.label}</span>
                  <span className={styles.value}>{stamp(d.at)}</span>
                  {d.score !== null && (
                    <span className={styles.tag}>Score then {formatScore(d.score)}</span>
                  )}
                </p>
                {d.rationale !== null && <p className={styles.plain}>{d.rationale}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <footer className={styles.foot}>
        Prepared by Beacon on {today}. Scores use the 18-point qualification rubric. Every cited
        sentence was found verbatim in its source document.
      </footer>
    </article>
  );
}

/** One printable page per firm: profile, score, cited evidence, open questions and decisions. */
export default function TearSheetPage(): React.ReactElement {
  usePrintMode();
  const { firmId = "" } = useParams();
  const firmQuery = useOsdkObjects(Firm, {
    where: { firmId: { $eq: firmId } },
    pageSize: 1,
    enabled: firmId !== "",
  });
  const findingsQuery = useOsdkObjects(ResearchFinding, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
    enabled: firmId !== "",
  });
  const decisionsQuery = useOsdkObjects(ReviewDecision, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
    enabled: firmId !== "",
  });
  const rules = useScreeningRules();

  const firm = ((firmQuery.data ?? [])[0] ?? undefined) as unknown as FirmView | undefined;
  const loading =
    firmQuery.isLoading ||
    findingsQuery.isLoading ||
    decisionsQuery.isLoading ||
    rules.configLoading ||
    rules.proposedRulesLoading;
  const error = firmQuery.error ?? findingsQuery.error ?? decisionsQuery.error;

  const sheet = React.useMemo(
    () =>
      firm === undefined || loading
        ? undefined
        : buildTearSheet({
            firm,
            findings: (findingsQuery.data ?? []) as unknown as FindingLike[],
            decisions: (decisionsQuery.data ?? []) as unknown as DecisionInput[],
            rules: rules.rankingRules,
          }),
    [firm, loading, findingsQuery.data, decisionsQuery.data, rules.rankingRules],
  );
  const today = React.useMemo(() => stamp(Date.now()), []);

  // "Save as PDF" names the file after the page title, so it names the firm.
  const name = sheet?.name;
  React.useEffect(() => {
    if (name !== undefined) {
      document.title = `Beacon — Tear sheet: ${name}`;
    }
  }, [name]);

  const print = React.useCallback(() => window.print(), []);
  const commands = React.useMemo<Command[]>(
    () =>
      sheet === undefined
        ? []
        : [
            {
              id: "tearsheet:print",
              label: "Print / Save as PDF",
              group: "Actions",
              run: print,
            },
          ],
    [sheet, print],
  );
  useCommands(commands);

  const deskHref = `/desk?firmId=${encodeURIComponent(firmId)}`;
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link to="/pipeline" className={styles.back}>
          Pipeline
        </Link>
        <div className={styles.actions}>
          <ButtonLink to={deskHref}>Open in the Desk</ButtonLink>
          <Button variant="primary" onClick={print} disabled={sheet === undefined}>
            Print / Save as PDF
          </Button>
        </div>
      </div>
      <div className={styles.scroll}>
        {error !== undefined && error !== null ? (
          <>
            <h1 className="sr-only">Tear sheet</h1>
            <Notice>Couldn&apos;t load the tear sheet: {String(error)}</Notice>
          </>
        ) : loading ? (
          <div role="status" aria-label="Loading tear sheet" className={styles.loading}>
            <h1 className="sr-only">Tear sheet</h1>
            <Skeleton height={32} />
            <Skeleton height={120} />
            <Skeleton height={200} />
          </div>
        ) : sheet === undefined ? (
          <>
            <h1 className="sr-only">Firm not found</h1>
            <EmptyState
              title="Firm not found"
              body="No firm has this id. It may have been removed, or the link is mistyped."
              action={<ButtonLink to="/pipeline">Open the Pipeline</ButtonLink>}
            />
          </>
        ) : (
          <Sheet sheet={sheet} today={today} />
        )}
      </div>
    </div>
  );
}
