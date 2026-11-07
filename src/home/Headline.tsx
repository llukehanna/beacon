import { Link } from "react-router-dom";
import { ButtonLink, Kbd } from "@/ui";
import styles from "./Headline.module.css";
import type { HeadlineText, NeedsPart } from "./headlineText";

/** The page header: today's date and mandate line, the one-sentence title and the main actions. */
export function Headline({
  dateLine,
  text,
  parts = [],
  status,
}: {
  dateLine: string;
  /** Null while the summary loads or when it failed; `status` then says why. */
  text: HeadlineText | null;
  /** The headline total split by where each kind of work is done; each part links there. */
  parts?: readonly NeedsPart[];
  status?: string;
}) {
  return (
    <header className={styles.head}>
      <div className={styles.copy}>
        <div className={styles.date}>{dateLine}</div>
        <h1 className={styles.title}>
          {text === null ? (
            status
          ) : (
            <>
              {text.lead}
              {text.detail !== null && <span> {text.detail}</span>}
            </>
          )}
        </h1>
        {text !== null && parts.length > 0 && (
          <p className={styles.parts} aria-label="What needs you, by kind">
            {parts.map((p, i) => (
              <span key={p.destination}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                <Link to={p.to}>{p.text}</Link>
              </span>
            ))}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <ButtonLink to="/mandate">New mandate</ButtonLink>
        <ButtonLink to="/desk" variant="primary">
          Open desk <Kbd>G D</Kbd>
        </ButtonLink>
      </div>
    </header>
  );
}
