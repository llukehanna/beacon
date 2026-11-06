import { Term } from "@/components/Term";
import styles from "./RuleParts.module.css";
import { type RuleLike, truncatePredicateAtWord } from "./rulesModel";

/** `axis op threshold` in mono, cut at a word boundary (the full text stays in the tooltip). */
export function PredicateCode({
  predicate,
  max = 48,
}: {
  /** Null when the rule is missing a component of its predicate. */
  predicate: string | null;
  max?: number;
}) {
  if (predicate === null) {
    return (
      <span
        className={styles.malformed}
        title="Predicate axis, operator, or threshold missing on this proposal. The FDE will remove it."
      >
        (malformed proposal: no predicate)
      </span>
    );
  }
  return (
    <code className={styles.predicate} title={predicate}>
      {truncatePredicateAtWord(predicate, max)}
    </code>
  );
}

/** Which model the rule applies to and which mandates it covers. */
export function RuleMeta({ rule, explainModel }: { rule: RuleLike; explainModel: boolean }) {
  if (!rule.ruleModel && !rule.mandateScope) {
    return null;
  }
  return (
    <div className={styles.meta}>
      {rule.ruleModel && (
        <span>
          {explainModel && rule.ruleModel === "both" ? (
            <Term id="Model: both">Model: both</Term>
          ) : (
            `Model: ${rule.ruleModel}`
          )}
        </span>
      )}
      {rule.mandateScope && <span>Scope: {rule.mandateScope}</span>}
    </div>
  );
}
