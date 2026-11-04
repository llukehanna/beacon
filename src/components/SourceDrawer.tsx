import React from "react";
import { Drawer, Tag } from "@blueprintjs/core";
import { useOsdkQuery } from "@/data/hooks";
import { highlightQuote, modelLabel } from "@/desk/sourceHighlight";
import styles from "./SourceDrawer.module.css";

/** The finding fields the drawer reads. */
export interface SourceDrawerFinding {
  sourceDocumentId?: string | null;
  sourceQuote?: string | null;
  extractionModel?: string | null;
  retrievedAt?: string | number | Date | null;
}

/** What the `sourceDocument` query function returns (the client-side view of it). */
interface SourceDocumentView {
  providerLabel: string;
  title: string;
  body: string;
}

/** A document id is `${provider}:${firmId}`; the finding's own provider can be a merged label. */
function parseDocumentId(id: string): { provider: string; firmId: string } | null {
  const at = id.indexOf(":");
  return at > 0 && at < id.length - 1
    ? { provider: id.slice(0, at), firmId: id.slice(at + 1) }
    : null;
}

function retrievedLabel(raw: SourceDrawerFinding["retrievedAt"]): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function Quoted({ body, quote }: { body: string; quote: string }): React.ReactElement {
  const split = React.useMemo(() => highlightQuote(body, quote), [body, quote]);
  const markRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = markRef.current;
    if (el !== null && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center" });
    }
  }, [split]);
  if (split === null) {
    return <pre className={styles.body}>{body}</pre>;
  }
  return (
    <pre className={styles.body}>
      {split.before}
      <mark ref={markRef}>{split.match}</mark>
      {split.after}
    </pre>
  );
}

function DrawerBody({ finding }: { finding: SourceDrawerFinding }): React.ReactElement {
  const ref = parseDocumentId(finding.sourceDocumentId ?? "");
  const { data, isLoading, error } = useOsdkQuery<SourceDocumentView>("sourceDocument", ref ?? {}, {
    enabled: ref !== null,
  });
  const retrieved = retrievedLabel(finding.retrievedAt);
  const model = modelLabel(finding.extractionModel);
  const quote = finding.sourceQuote ?? "";

  return (
    <div className={styles.content}>
      <div className={styles.meta}>
        <Tag minimal>Mock source</Tag>
        {data !== undefined && <span className={styles.provider}>{data.providerLabel}</span>}
        {retrieved !== null && <span>Retrieved {retrieved}</span>}
        {model !== null && <span>Extracted by {model}</span>}
      </div>
      {data !== undefined && <h3 className={styles.docTitle}>{data.title}</h3>}
      {ref === null && <div className={styles.status}>This finding has no source document.</div>}
      {ref !== null && isLoading && (
        <div role="status" className={styles.status}>
          Loading document…
        </div>
      )}
      {ref !== null && error !== undefined && (
        <div role="alert" className={styles.status}>
          Could not load this document: {error.message}
        </div>
      )}
      {data !== undefined && <Quoted body={data.body} quote={quote} />}
      <p className={styles.note}>
        Synthetic record generated for this demo. Values in it may be wrong on purpose.
      </p>
    </div>
  );
}

/** Right-hand drawer with a finding's mock source document and its quote highlighted. */
export function SourceDrawer({
  finding,
  onClose,
}: {
  finding: SourceDrawerFinding | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Drawer
      isOpen={finding !== null}
      onClose={onClose}
      position="right"
      size={520}
      title="Source document"
      className={`${styles.drawer} bp6-dark`}
      portalClassName="dsn"
    >
      {finding !== null && <DrawerBody finding={finding} />}
    </Drawer>
  );
}

const OpenSource = React.createContext<(finding: SourceDrawerFinding) => void>(() => undefined);

/** Holds the one drawer a page shows; cards below it open it with `ViewSourceButton`. */
export function SourceDrawerProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [finding, setFinding] = React.useState<SourceDrawerFinding | null>(null);
  const close = React.useCallback(() => setFinding(null), []);
  return (
    <OpenSource.Provider value={setFinding}>
      {children}
      <SourceDrawer finding={finding} onClose={close} />
    </OpenSource.Provider>
  );
}

/** "View source" for a finding; renders nothing when the finding cites no document. */
export function ViewSourceButton({
  finding,
  label = "View source",
}: {
  finding: SourceDrawerFinding;
  label?: string;
}): React.ReactElement | null {
  const open = React.useContext(OpenSource);
  if (!finding.sourceDocumentId) {
    return null;
  }
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 12, padding: "3px 8px", color: "var(--color-accent)" }}
      onClick={() => open(finding)}
    >
      {label}
    </button>
  );
}
