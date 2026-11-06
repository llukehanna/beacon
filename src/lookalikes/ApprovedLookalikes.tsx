import React from "react";
import { Button, Panel } from "@/ui";
import type { FirmLike } from "../../shared/exportRows";
import { APPROVED_CAP, lookalikesOfApproved } from "../../shared/lookalikes";
import styles from "./ApprovedLookalikes.module.css";
import { LookalikeList } from "./LookalikeList";

/**
 * Pipeline panel: firms like the approved targets (Qualified or later) in the current view. The
 * comparison runs over every firm, not just the view, so a lookalike the filters hide still shows
 * up; the approved firms themselves are left out.
 */
export function ApprovedLookalikes({
  approved,
  universe,
  onClose,
}: {
  approved: readonly FirmLike[];
  universe: readonly FirmLike[];
  onClose: () => void;
}): React.ReactElement {
  const rows = React.useMemo(() => lookalikesOfApproved(approved, universe), [approved, universe]);
  const count = approved.length;
  return (
    <Panel className={styles.panel} aria-labelledby="approved-lookalikes-title">
      <div className={styles.head}>
        <h2 id="approved-lookalikes-title" className={styles.heading}>
          Lookalikes of approved targets
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {count === 0 ? (
        <p className={styles.plain}>
          No approved targets in this view. Approved means Qualified or later, so widen the stage or
          clear the filters.
        </p>
      ) : rows.length === 0 ? (
        <p className={styles.plain}>
          No other firm shares enough with the {count} approved {count === 1 ? "target" : "targets"}{" "}
          in this view.
        </p>
      ) : (
        <>
          <p className={styles.plain}>
            Up to {APPROVED_CAP} firms most like the {count} approved{" "}
            {count === 1 ? "target" : "targets"} in this view, best match first. Passed firms are
            listed too, flagged.
          </p>
          <LookalikeList rows={rows} label="Lookalikes of approved targets" />
        </>
      )}
    </Panel>
  );
}
