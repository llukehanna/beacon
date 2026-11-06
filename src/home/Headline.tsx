import { useNavigate } from "react-router-dom";
import { Button, Kbd } from "@/ui";
import styles from "./Headline.module.css";
import type { HeadlineText } from "./headlineText";

/** The page header: today's date and mandate line, the one-sentence title and the main actions. */
export function Headline({
  dateLine,
  text,
  status,
}: {
  dateLine: string;
  /** Null while the summary loads or when it failed; `status` then says why. */
  text: HeadlineText | null;
  status?: string;
}) {
  const navigate = useNavigate();
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
      </div>
      <div className={styles.actions}>
        <Button onClick={() => navigate("/mandate")}>New mandate</Button>
        <Button variant="primary" onClick={() => navigate("/desk")}>
          Open desk <Kbd>G D</Kbd>
        </Button>
      </div>
    </header>
  );
}
