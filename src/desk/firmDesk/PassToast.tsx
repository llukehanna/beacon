import React from "react";
import { Link } from "react-router-dom";
import styles from "./PassToast.module.css";

/** How long the note stays up on its own. */
const SHOW_MS = 12_000;

/**
 * Says a pass was saved and where its reason goes next: the rule review, where passes with a shared
 * reason become proposed rules. It clears itself; there is no Undo, as decisions are append-only.
 */
export function PassToast({
  firmName,
  onClose,
}: {
  firmName: string;
  onClose: () => void;
}): React.ReactElement {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const t = window.setTimeout(() => close.current(), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [firmName]);
  return (
    <div role="status" className={styles.toast}>
      <span>
        Passed {firmName}. Its reason joins the <Link to="/rules">rule review</Link>.
      </span>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
