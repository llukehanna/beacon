import React from "react";
import { useOsdkQuery } from "@/data/hooks";
import { Skeleton } from "@/ui";
import { docLines } from "../sourceHighlight";
import styles from "./SourceView.module.css";

/** What the `sourceDocument` query function returns (the client-side view of it). */
interface SourceDocumentView {
  providerLabel: string;
  title: string;
  body: string;
}

/** A document id is `${provider}:${firmId}`. */
function parseDocumentId(id: string): { provider: string; firmId: string } | null {
  const at = id.indexOf(":");
  return at > 0 && at < id.length - 1
    ? { provider: id.slice(0, at), firmId: id.slice(at + 1) }
    : null;
}

/**
 * A provider's mock source document with line numbers; the cited line is tinted and the quote
 * underlined. The document is fetched from the `sourceDocument` query function.
 */
export function SourceView({
  documentId,
  quote,
}: {
  documentId: string;
  quote: string | null;
}): React.ReactElement {
  const ref = parseDocumentId(documentId);
  const { data, isLoading, error } = useOsdkQuery<SourceDocumentView>("sourceDocument", ref ?? {}, {
    enabled: ref !== null,
  });
  const view = React.useMemo(
    () => (data === undefined ? null : docLines(data.body, quote)),
    [data, quote],
  );
  const scroller = React.useRef<HTMLDivElement>(null);
  // Bring the cited line to the middle of the document box without moving the page.
  React.useEffect(() => {
    const box = scroller.current;
    const cited = box?.querySelector<HTMLElement>('[data-cited="true"]');
    if (box && cited) {
      box.scrollTop = Math.max(0, cited.offsetTop - box.clientHeight / 2 + cited.clientHeight / 2);
    }
  }, [view]);

  return (
    <figure className={styles.doc} aria-label="Source document">
      <figcaption className={styles.head}>
        <span>{data === undefined ? "Source document" : `${data.providerLabel} record`}</span>
        <span>mock source</span>
      </figcaption>
      {ref === null && <p className={styles.status}>This finding has no source document.</p>}
      {ref !== null && isLoading && (
        <div role="status" aria-label="Loading document" className={styles.loading}>
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} />
        </div>
      )}
      {ref !== null && error !== undefined && (
        <p role="alert" className={styles.status}>
          Could not load this document: {error.message}
        </p>
      )}
      {view !== null && (
        <>
          {!view.found && quote !== null && (
            <p role="status" className={styles.status}>
              The cited passage is not in the current version of this record.
            </p>
          )}
          <div className={styles.lines} ref={scroller}>
            {view.lines.map((line) => (
              <div
                key={line.n}
                className={`${styles.ln} ${line.cited ? styles.hl : ""}`}
                data-cited={line.cited ? "true" : undefined}
              >
                <span className={styles.num} aria-hidden="true">
                  {line.n}
                </span>
                <span className={styles.text}>
                  {line.text === ""
                    ? " "
                    : line.parts.map((p, i) =>
                        p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
                      )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </figure>
  );
}
