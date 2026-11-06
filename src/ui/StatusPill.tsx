import styles from "./StatusPill.module.css";

export type FindingStatus = "conflict" | "proposed" | "verified" | "abstained" | "rejected";

const LABEL: Record<FindingStatus, string> = {
  conflict: "Conflict",
  proposed: "Proposed",
  verified: "Verified",
  abstained: "Abstained",
  rejected: "Rejected",
};

/** Status of a finding: a dot and a label, coloured by meaning. */
export function StatusPill({ status }: { status: FindingStatus }) {
  return (
    <span className={`${styles.pill} ${styles[status]}`} data-status={status}>
      {LABEL[status]}
    </span>
  );
}
