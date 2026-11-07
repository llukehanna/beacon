import React from "react";
import { Link } from "react-router-dom";
import { Notice } from "@/ui";
import { DocPage, DocSection, ExternalLink } from "./DocLayout";
import styles from "./TrustPage.module.css";
import {
  ACCESS_LOG_CEILING,
  ACCESS_LOG_DEBOUNCE_SECONDS,
  ACTIONS_PER_MINUTE,
  ACTIVITY_ROW_CEILING,
  CLAUDE_COOLDOWN_MINUTES,
  CLAUDE_DAILY_MAX,
  CSP_DIRECTIVES,
  FIRM_COUNT,
  MANDATE_CEILING,
  MAX_BODY_BYTES,
  MCP_PER_MINUTE,
  MIN_FIRMS_PER_RULE,
  NIGHTLY_RESET_UTC,
  OTHER_HEADERS,
  RECORDED_RUN,
  RESETS_PER_MINUTE,
  RESET_COOLDOWN_MINUTES,
  RESTRICTED_FIRM_COUNT,
  SEARCH_CEILING,
  SECURITY_DOC_URL,
} from "./facts";

const n = (v: number): string => v.toLocaleString("en-US");

/** The full statement of a section lives in docs/security.md, under the same heading. */
function More({ anchor }: { anchor: string }): React.ReactElement {
  return (
    <p>
      <ExternalLink href={`${SECURITY_DOC_URL}#${anchor}`}>Sources and detail</ExternalLink>
    </p>
  );
}

/**
 * What Beacon does with data, models and access, in short. Every figure comes from `facts.ts`,
 * which `server/trustClaims.test.ts` pins to the code and config; docs/security.md holds the same
 * statements with the source file named beside each.
 */
export default function TrustPage(): React.ReactElement {
  return (
    <DocPage
      title="Trust and security"
      sub="What Beacon does with data, models and access, stated plainly"
    >
      <Notice tone="accent">
        Beacon is a public demo with synthetic data and no sign-in. Do not enter anything real. This
        page summarises <ExternalLink href={SECURITY_DOC_URL}>docs/security.md</ExternalLink>, which
        names the source file behind each claim. Anything not built is listed at the end.
      </Notice>

      <DocSection id="data" title="Data handling">
        <ul>
          <li>
            All {n(FIRM_COUNT)} firms and every source record are synthetic. Nothing real is loaded.
          </li>
          <li>
            What a visitor types (mandates, pass reasons, values entered by hand) goes into one
            shared database that every visitor can read until the next reset.
          </li>
          <li>The API has no authentication.</li>
        </ul>
        <More anchor="data-handling" />
      </DocSection>

      <DocSection id="tenancy" title="Tenancy">
        <ul>
          <li>
            One shared demo and one shared analyst. There are no accounts, sign-in or organisations.
            The only roles are the three demo personas of the information barrier below, which
            anyone can pick.
          </li>
          <li>
            A production deployment would add sign-in, a tenant per organisation with isolation in
            the database, and permission checks on each action. None of that is built.
          </li>
        </ul>
        <More anchor="tenancy" />
      </DocSection>

      <DocSection id="barriers" title="Information barriers (demo)">
        <ul>
          <li>
            Beacon demonstrates a wall between people on a deal: {RESTRICTED_FIRM_COUNT} firms are
            restricted, and one mandate is closed to the analyst. It shows how a wall behaves; it is
            not a security control.
          </li>
          <li>
            <b>The identity is demo-only.</b> The persona (analyst, deal-team lead or compliance) is
            picked in the sidebar and sent in a request header. The server trusts it and nothing
            checks who you are, so anyone can pick any persona. A real deployment would derive the
            persona from single sign-on, never from a header.
          </li>
          <li>
            A restricted firm is visible to compliance alone, with its reason. For the analyst and
            the deal-team lead it is missing from lists, lookups, counts, exports, tear sheets and
            search, and an action on it is a not-found. Counts the agent computes or stored when a
            search ran may still include a restricted firm.
          </li>
          <li>
            Without need-to-know, a mandate keeps its place and its firms but shows a codename
            instead of its title and intent.
          </li>
          <li>
            Opening a firm in detail or a mandate adds a row to an access log that compliance can
            read. It keeps the newest {n(ACCESS_LOG_CEILING)} rows, counts a repeat view within{" "}
            {ACCESS_LOG_DEBOUNCE_SECONDS} seconds once, and is cleared by every reset.
          </li>
          <li>
            An AI assistant can read the demo through a read-only MCP endpoint. It gets the same
            view as the persona it names in the header, can change nothing, and receives at most 25
            rows from any list. What the assistant&rsquo;s provider does with that data is governed
            by that provider&rsquo;s terms.
          </li>
          <li>
            In Foundry a restricted firm is a Marking on the object, and need-to-know is a
            mandate-level Marking or a restricted view.
          </li>
        </ul>
        <More anchor="information-barriers-demo" />
      </DocSection>

      <DocSection id="secrets" title="Secrets">
        <ul>
          <li>
            The production Worker reads one secret, the database connection string, stored as a
            Worker secret.
          </li>
          <li>
            GitHub Actions secrets hold the Anthropic key for the extraction workflow and the
            database strings for reseeding.
          </li>
          <li>The browser bundle holds no key or connection string.</li>
        </ul>
        <More anchor="secrets" />
      </DocSection>

      <DocSection id="retention" title="Retention">
        <ul>
          <li>
            The demo is restored from a snapshot every night at {NIGHTLY_RESET_UTC} UTC, which
            deletes everything entered since the last reset. The Reset button does the same, at most
            once per {RESET_COOLDOWN_MINUTES} minutes.
          </li>
          <li>
            Backups and retention on the database host are set in that provider&rsquo;s console,
            outside this repository, and are not described here.
          </li>
        </ul>
        <More anchor="retention" />
      </DocSection>

      <DocSection id="models" title="Model-provider data use">
        <ul>
          <li>
            {RECORDED_RUN.model} (through the Message Batches API) read the synthetic source records
            offline, once per firm. The recorded answers are committed as fixtures, and the demo
            reads those. In that run {n(RECORDED_RUN.valuesGrounded)} of{" "}
            {n(RECORDED_RUN.valuesExtracted)} values passed the grounding check, at a cost of{" "}
            {RECORDED_RUN.extractionCost}.
          </li>
          <li>
            The live app can make one kind of Claude call, rule clustering, and only when an
            operator turns it on. It sends visitors&rsquo; pass reasons and a few firm facts, never
            firm names.
          </li>
          <li>
            The guard allows at most one call per {CLAUDE_COOLDOWN_MINUTES} minutes and{" "}
            {CLAUDE_DAILY_MAX} per UTC day across all visitors, claimed before the action runs so a
            failed action does not refund it. Past a limit, or on any failure, a keyword heuristic
            proposes the rules instead.
          </li>
          <li>
            The documented production setup holds no Anthropic key, so as documented live clustering
            is the heuristic.
          </li>
        </ul>
        <More anchor="model-provider-data-use" />
      </DocSection>

      <DocSection id="ai-risk" title="AI-risk notes">
        <ul>
          <li>
            <b>Grounding.</b> A value is kept only if its quote appears word for word in the source
            record and contains the value. This shows an answer quotes its record faithfully, not
            that the value is true: the mock sources carry deliberate errors.
          </li>
          <li>
            <b>Abstention.</b> If no source supports an axis, Beacon records that instead of
            guessing.
          </li>
          <li>
            <b>Conflicts are surfaced.</b> When sources disagree, both are shown and the analyst
            chooses.
          </li>
          <li>
            <b>Human approval for rules.</b> A proposed rule needs at least {MIN_FIRMS_PER_RULE}{" "}
            distinct firms and screens nothing until an analyst approves it.
          </li>
          <li>
            <b>Scores are not model output.</b> The rubric is plain code.
          </li>
        </ul>
        <More anchor="ai-risk-notes" />
      </DocSection>

      <DocSection id="audit" title="Audit trail">
        <ul>
          <li>
            Scores and review decisions are only ever inserted. Findings, drift events and rules
            change only their status fields, and a human override creates a new finding.
          </li>
          <li>
            <b>This is enforced in application code, not in the database.</b> Every write goes
            through a named action, and none updates those rows beyond the fields above. The
            database has no triggers or revoked privileges, and the Worker connects with full
            rights.
          </li>
          <li>The nightly reset clears the history, so the trail covers one demo day.</li>
        </ul>
        <More anchor="audit-trail" />
      </DocSection>

      <DocSection id="headers" title="Security headers and rate limits">
        <p>The Content-Security-Policy on every page and asset:</p>
        <ul className={styles.csp} aria-label="Content-Security-Policy directives">
          {CSP_DIRECTIVES.map((d) => (
            <li key={d}>
              <code>{d}</code>
            </li>
          ))}
        </ul>
        <p>
          It allows inline styles and Cloudflare&rsquo;s analytics script. Other headers:{" "}
          {OTHER_HEADERS.map(([name, value], i) => (
            <React.Fragment key={name}>
              {i > 0 && ", "}
              <code>
                {name}: {value}
              </code>
            </React.Fragment>
          ))}
          .
        </p>
        <ul>
          <li>
            Per client IP: {ACTIONS_PER_MINUTE} action requests, {RESETS_PER_MINUTE} resets and{" "}
            {MCP_PER_MINUTE} MCP requests per minute.
          </li>
          <li>
            A POST naming another origin is refused, and a body must be JSON of at most{" "}
            {n(MAX_BODY_BYTES)} bytes.
          </li>
          <li>
            The shared demo is capped at {MANDATE_CEILING} mandates, {SEARCH_CEILING} searches and{" "}
            {n(ACTIVITY_ROW_CEILING)} activity rows until the next reset.
          </li>
        </ul>
        <More anchor="security-headers-and-rate-limits" />
      </DocSection>

      <DocSection id="not-built" title="Not built">
        <ul>
          <li>
            Authentication, accounts, real roles and per-user permissions. The information
            barrier&rsquo;s personas are a demo.
          </li>
          <li>Tenant isolation.</li>
          <li>Database-enforced immutability of the audit trail.</li>
          <li>Any compliance certification. None is claimed.</li>
        </ul>
        <p>
          See also <Link to="/about">About Beacon</Link> and the{" "}
          <Link to="/accuracy">Accuracy</Link> page.
        </p>
      </DocSection>
    </DocPage>
  );
}
