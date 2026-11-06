import React from "react";
import { Drawer } from "@blueprintjs/core";
import { type FindingLike } from "../axisState";
import { type Model } from "../scoreMirror";
import { EvidenceBody } from "./EvidenceBody";
import styles from "./EvidencePanel.module.css";
import { HistoryTab } from "./HistoryTab";
import { type AxisRow } from "./axisRows";
import { type EditMap, type FirmView } from "./deskModel";
import { EVIDENCE_DRAWER_CLASS } from "./dialogs";
import { type OnFile } from "./onFile";

type Staged = string | number | boolean;
type Tab = "evidence" | "history";

export interface EvidenceProps {
  /** The selected row; undefined until one is chosen. */
  row: AxisRow | undefined;
  firm: FirmView;
  allFirms: FirmView[];
  firmsLoading: boolean;
  model: Model;
  edits: EditMap;
  onFile: Record<string, OnFile>;
  getCurrent: (editKey: string) => Staged | null | undefined;
  applyEdit: (editKey: string, value: Staged) => void;
  queueVerify: (f: FindingLike, overrideValue?: string) => void;
  provider: string | undefined;
  onProvider: (provider: string) => void;
}

function Panel({
  variant,
  ...props
}: EvidenceProps & { variant: "column" | "drawer" }): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>("evidence");
  const body = (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Evidence panel">
        {(["evidence", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`evidence-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="evidence-tabpanel"
            className={styles.tab}
            onClick={() => setTab(t)}
          >
            {t === "evidence" ? "Evidence" : "History"}
          </button>
        ))}
      </div>
      <div
        id="evidence-tabpanel"
        role="tabpanel"
        aria-labelledby={`evidence-tab-${tab}`}
        className={styles.content}
      >
        {tab === "history" ? (
          <HistoryTab
            firm={props.firm}
            allFirms={props.allFirms}
            firmsLoading={props.firmsLoading}
          />
        ) : props.row === undefined ? (
          <p className={styles.note}>
            Select an axis to see the source behind each value and the checks it passed.
          </p>
        ) : (
          <EvidenceBody
            // A new axis starts from a clean slate (open editors, prompts, errors).
            key={`${props.firm.firmId}:${props.row.axis}`}
            row={props.row}
            model={props.model}
            edits={props.edits}
            onFile={props.onFile[props.row.axis]}
            getCurrent={props.getCurrent}
            applyEdit={props.applyEdit}
            queueVerify={props.queueVerify}
            provider={props.provider}
            onProvider={props.onProvider}
          />
        )}
      </div>
    </>
  );
  return variant === "column" ? (
    <aside className={styles.evidence} aria-label="Evidence">
      {body}
    </aside>
  ) : (
    <div className={`${styles.evidence} ${styles.inDrawer}`}>{body}</div>
  );
}

/** The 340 px evidence column on the right of the Desk (1280 px and wider). */
export function EvidencePanel(props: EvidenceProps): React.ReactElement {
  return <Panel variant="column" {...props} />;
}

/** The same panel as a right-hand drawer, for screens under 1280 px. */
export function EvidenceDrawer({
  isOpen,
  onClose,
  ...props
}: EvidenceProps & { isOpen: boolean; onClose: () => void }): React.ReactElement {
  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      position="right"
      size="min(400px, 100vw)"
      title={props.row?.label ?? "Evidence"}
      className={`${styles.drawer} ${EVIDENCE_DRAWER_CLASS} bp6-dark`}
      portalClassName="dsn"
    >
      <Panel variant="drawer" {...props} />
    </Drawer>
  );
}
