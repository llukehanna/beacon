import { Button } from "@/ui";
import styles from "./ProposeRulesButton.module.css";
import { type ProposeRules } from "./useProposeRules";

/** Sits at the right of the Rules header: cluster rejections into proposed screening rules. */
export function ProposeRulesButton({ propose }: { propose: ProposeRules }) {
  return (
    <div className={styles.wrap}>
      {propose.note !== null && (
        <span className={styles.note} role="status">
          {propose.note}
        </span>
      )}
      {propose.error !== undefined && (
        <span className={styles.error} role="alert">
          {propose.error}
        </span>
      )}
      <Button onClick={propose.run} disabled={propose.isPending}>
        {propose.isPending ? "Reading rejections…" : "Propose rules from rejections"}
      </Button>
    </div>
  );
}
