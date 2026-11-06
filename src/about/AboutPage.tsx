import React from "react";
import { Link } from "react-router-dom";
import { useTour } from "@/tour/tourContext";
import { Button } from "@/ui";
import styles from "./AboutPage.module.css";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { DocPage, DocSection, ExternalLink } from "./DocLayout";
import {
  ACTION_COUNT,
  ARCHITECTURE_DOC_URL,
  AUTHOR_URL,
  AXIS_COUNT,
  FOUNDRY_DOC_URL,
  OBJECT_TYPE_COUNT,
  REPO_URL,
  RUBRIC_MAX,
} from "./facts";

const STEPS: ReadonlyArray<{ title: string; body: React.ReactNode }> = [
  {
    title: "Mandate to search",
    body: (
      <>
        Leadership writes what it is after in plain words. Beacon turns that into a{" "}
        <Link to="/mandate">mandate</Link> and a search over a universe of candidate firms.
      </>
    ),
  },
  {
    title: "Agent enrichment with cited evidence",
    body: (
      <>
        For each firm an agent reads several sources on the <Link to="/desk">Desk</Link>. Every
        value it proposes carries the exact sentence it came from, and is kept only if that sentence
        is in the source. Where no source supports an axis, it abstains instead of guessing, and
        where two sources disagree it shows both rather than picking one.
      </>
    ),
  },
  {
    title: "A deterministic rubric",
    body: (
      <>
        A plain-code rubric of {AXIS_COUNT} axes, each scored 0 to 2 ({RUBRIC_MAX} points), turns
        the values on file into a score and a tier. The same module runs in the browser for live
        previews and on the server for the record, so the two cannot disagree.
      </>
    ),
  },
  {
    title: "Analyst decisions",
    body: (
      <>
        Analysts accept, override, qualify or pass. Passing takes a written reason, and every
        decision is kept in history rather than overwritten.
      </>
    ),
  },
  {
    title: "Rules learned from reasons, with approval",
    body: (
      <>
        When enough passes share a reason, Beacon drafts a screening <Link to="/rules">rule</Link>,
        shows the firms it came from and how many it would screen, and does nothing until an analyst
        approves it.
      </>
    ),
  },
  {
    title: "Drift",
    body: (
      <>
        When new evidence moves a firm you already decided on, it returns to{" "}
        <Link to="/review">Review</Link> with the reason, so an old call is looked at again instead
        of going stale.
      </>
    ),
  },
];

const LEGEND: ReadonlyArray<{ term: string; text: string }> = [
  { term: "Analyst in the browser", text: "The React app. Every screen reads through the API." },
  {
    term: "API",
    text: "A small Cloudflare Worker. It serves read-only queries, the route that applies actions, and the demo reset.",
  },
  {
    term: "Actions",
    text: `The only way to write: ${ACTION_COUNT} named actions, each validated and run in one transaction.`,
  },
  {
    term: "Agent",
    text: "Reads each firm's source records, checks every quote, and reconciles what the sources say.",
  },
  {
    term: "Rubric",
    text: "Scores and tiers a firm. One module, shared by the browser and the server.",
  },
  {
    term: "Rules",
    text: "Clusters analysts' pass reasons into proposed rules, held for approval.",
  },
  {
    term: "Postgres",
    text: `Neon in production. One schema of ${OBJECT_TYPE_COUNT} object types describes the data. Scores and decisions are only ever added, never edited.`,
  },
  {
    term: "Offline: Claude extraction",
    text: "Claude reads the source records ahead of time, and its answers are committed as fixtures. The live app grounds those recorded answers and does not call a model to enrich a firm.",
  },
];

/** What Beacon is, the problem it answers, how it works, where it came from and where to look next. */
export default function AboutPage(): React.ReactElement {
  const { start } = useTour();
  return (
    <DocPage
      title="About Beacon"
      sub="An AI-assisted sourcing desk for acquisition targets that shows its work"
    >
      <DocSection id="problem" title="The problem">
        <p>
          A corporate development team looking for acquisition targets has to work through hundreds
          of advisory firms. The facts about each one are scattered: a deal database says one thing,
          a filing another, the firm&rsquo;s own website a third. Someone has to reconcile them,
          remember why a firm was passed on, and notice when something changes.
        </p>
        <p>
          Beacon is a desk for that work. It lets an AI agent do the reading, and keeps the analyst
          in charge of every judgment.
        </p>
      </DocSection>

      <DocSection id="approach" title="How Beacon approaches it">
        <ol className={styles.steps}>
          {STEPS.map((s) => (
            <li key={s.title}>
              <b>{s.title}.</b> {s.body}
            </li>
          ))}
        </ol>
        <div className={styles.cta}>
          <Button variant="primary" onClick={start}>
            Take the 60-second tour
          </Button>
          <span>Six stops, read-only. It never changes any data.</span>
        </div>
      </DocSection>

      <DocSection id="architecture" title="Architecture">
        <div className={styles.arch}>
          <ArchitectureDiagram />
          <dl className={styles.legend}>
            {LEGEND.map((l) => (
              <div key={l.term}>
                <dt>{l.term}</dt>
                <dd>{l.text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p>
          The <ExternalLink href={ARCHITECTURE_DOC_URL}>architecture document</ExternalLink> goes
          through each part in detail.
        </p>
      </DocSection>

      <DocSection id="origin" title="Where it came from">
        <p>
          Beacon was built as a Palantir American Tech Fellowship capstone on Palantir Foundry,
          using its ontology, functions, actions and AI tooling. It was then ported to an open stack
          behind the same screens: React, a Cloudflare Worker and Neon Postgres. The data is
          synthetic, and the rubric was redesigned for the public version.{" "}
          <ExternalLink href={FOUNDRY_DOC_URL}>From Foundry to an open stack</ExternalLink> maps
          each Foundry concept to what replaced it.
        </p>
        <p>
          Beacon is built by <ExternalLink href={AUTHOR_URL}>Luke Hanna</ExternalLink>.
        </p>
      </DocSection>

      <DocSection id="links" title="Look further">
        <ul className={styles.links}>
          <li>
            <ExternalLink href={REPO_URL}>Source code on GitHub</ExternalLink>
          </li>
          <li>
            <Link to="/accuracy">Accuracy</Link>: how often analysts kept what the agent proposed,
            overrode it, or it abstained
          </li>
          <li>
            <Link to="/trust">Trust and security</Link>: data, models, access and the audit trail
          </li>
          <li>
            <ExternalLink href={ARCHITECTURE_DOC_URL}>Architecture document</ExternalLink>
          </li>
        </ul>
      </DocSection>
    </DocPage>
  );
}
