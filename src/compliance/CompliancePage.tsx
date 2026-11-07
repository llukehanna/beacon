import React from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "@/data/adapter";
import { useOsdkObjects } from "@/data/hooks";
import { AccessLogEntry, Firm, Mandate, RestrictedFirm } from "@/data/ontology";
import { usePersona } from "@/data/persona";
import { SectionHead } from "@/home/SectionHead";
import { Chip, EmptyState, Notice, PageHeader, Panel, Skeleton } from "@/ui";
import styles from "./CompliancePage.module.css";
import { logTime, objectName, personaLabel } from "./complianceModel";

const LOG_ROWS = 100;

/**
 * Compliance: the firms behind the information barrier with the reason for each, and the log of
 * who opened which firm or mandate. Only the compliance persona can read either (the server refuses
 * anyone else), so any other persona sees an empty state here. Demo-only: the persona is chosen in
 * the sidebar and is not a login.
 */
export default function CompliancePage(): React.ReactElement {
  const persona = usePersona();
  const allowed = persona === "compliance";
  const restricted = useOsdkObjects(RestrictedFirm, {
    orderBy: { addedAt: "desc" },
    autoFetchMore: true,
    enabled: allowed,
  });
  const log = useOsdkObjects(AccessLogEntry, {
    orderBy: { viewedAt: "desc" },
    pageSize: LOG_ROWS,
    enabled: allowed,
    // The log changes with every firm anyone opens: read it again each time this page opens.
    staleTime: 0,
  });
  // The same lists the palette and the Desk use, so the names cost no extra request when cached.
  const firms = useOsdkObjects(Firm, {
    orderBy: { firmName: "asc" },
    autoFetchMore: true,
    enabled: allowed,
  });
  const mandates = useOsdkObjects(Mandate, { autoFetchMore: true, enabled: allowed });

  const firmNames = React.useMemo(
    () => new Map((firms.data ?? []).map((f) => [f.firmId, f.firmName ?? f.firmId])),
    [firms.data],
  );
  const mandateNames = React.useMemo(
    () => new Map((mandates.data ?? []).map((m) => [m.mandateId, m.title ?? m.mandateId])),
    [mandates.data],
  );

  const restrictedRows = restricted.data ?? [];
  const logRows = log.data ?? [];
  const error = restricted.error ?? log.error;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Information barriers"
        sub="Restricted firms, who looked at what, and how the wall works. Demo data."
        actions={<Chip>Demo</Chip>}
      />
      <div className={styles.scroll}>
        {!allowed ? (
          <EmptyState
            title="Compliance only"
            body="Restricted firms and the access log are visible to the compliance persona alone. Switch the demo persona in the sidebar to see them. The persona is a demo control, not a login."
          />
        ) : (
          <>
            {error !== undefined && (
              <Notice>Could not load the barrier data: {errorMessage(error)}</Notice>
            )}
            <Panel className={styles.panel} aria-labelledby="restricted-title">
              <SectionHead
                title={<span id="restricted-title">Restricted firms</span>}
                count={restricted.data === undefined ? undefined : restrictedRows.length}
              />
              <p className={styles.lede}>
                Analysts and deal-team leads cannot see these firms anywhere: not in lists, search,
                counts, exports or tear sheets.
              </p>
              {restricted.isLoading ? (
                <Skeleton lines={3} />
              ) : restrictedRows.length === 0 ? (
                <p className={styles.none}>No firm is restricted.</p>
              ) : (
                <div className={styles.scrollX}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Firm</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {restrictedRows.map((r) => (
                        <tr key={r.firmId}>
                          <th scope="row">
                            <Link to={`/desk?firmId=${encodeURIComponent(r.firmId)}`}>
                              {firmNames.get(r.firmId) ?? r.firmId}
                            </Link>
                          </th>
                          <td>{r.reason ?? "—"}</td>
                          <td className={styles.time}>{logTime(r.addedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel className={styles.panel} aria-labelledby="log-title">
              <SectionHead
                title={<span id="log-title">Access log</span>}
                count={log.data === undefined ? undefined : logRows.length}
              />
              <p className={styles.lede}>
                The newest {LOG_ROWS} times a persona opened a firm or a mandate (demo log, kept to
                the latest 500 and cleared on reset).
              </p>
              {log.isLoading ? (
                <Skeleton lines={4} />
              ) : logRows.length === 0 ? (
                <p className={styles.none}>
                  Nothing opened yet. Open a firm on the Desk, then come back.
                </p>
              ) : (
                <div className={styles.scrollX}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Persona</th>
                        <th scope="col">Opened</th>
                        <th scope="col">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logRows.map((r) => (
                        <tr key={r.entryId}>
                          <td>{personaLabel(r.persona)}</td>
                          <td>
                            <Chip>{r.objectType ?? "—"}</Chip>{" "}
                            {objectName(r, firmNames, mandateNames)}
                          </td>
                          <td className={styles.time}>{logTime(r.viewedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel className={styles.panel} aria-labelledby="how-title">
              <SectionHead title={<span id="how-title">How the wall works (demo)</span>} />
              <ul className={styles.how}>
                <li>
                  <b>Restricted firms</b> are removed on the server for every persona except
                  compliance, so an analyst gets a not-found for them, as if they did not exist.
                </li>
                <li>
                  <b>Need-to-know</b> hides a mandate&rsquo;s title and intent behind its codename
                  for a persona without access. The mandate and its firms stay visible.
                </li>
                <li>
                  <b>The persona is demo-only.</b> It is sent in a request header that anyone can
                  set. A real deployment takes it from single sign-on and enforces it in the data
                  layer, as Foundry Markings do.
                </li>
              </ul>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
