import React from "react";
import { Link } from "react-router-dom";
import styles from "./PassToast.module.css";

/** How long the note stays up on its own. */
const SHOW_MS = 12_000;

/**
 * Says a pass was saved and where its reason goes next: the rule review, where passes with a shared
 * reason become proposed rules. It clears itself; there is no Undo, as decisions are append-only.
 *
 * The live region is on the page from the start and empty until a pass lands: a region that
 * arrives with its text already inside is often not announced, VoiceOver's in particular.
 */
export function PassToast({
  firmName,
  onClose,
}: {
  /** The firm just passed; null while there is nothing to say. */
  firmName: string | null;
  onClose: () => void;
}): React.ReactElement {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (firmName === null) {
      return undefined;
    }
    const t = window.setTimeout(() => close.current(), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [firmName]);
  return (
    <div role="status" className={styles.region} data-testid="pass-toast">
      {firmName !== null && (
        <div className={styles.toast}>
          <span>
            Passed {firmName}. Its reason joins the <Link to="/rules">rule review</Link>.
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
