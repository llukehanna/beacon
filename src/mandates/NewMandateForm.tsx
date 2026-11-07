import React from "react";
import { Term } from "@/components/Term";
import { useOsdkAction } from "@/data/hooks";
import { runMandateSearchAction } from "@/data/ontology";
import { Button, Notice, Panel, Segmented, Textarea } from "@/ui";
import styles from "./NewMandateForm.module.css";

const ARCHETYPES = ["CF", "CS"] as const;
const PRIORITIES = ["High", "Medium", "Low"] as const;

/** Scopes a new mandate from a free-text intent, an archetype and a priority. */
export function NewMandateForm({
  intentRef,
}: {
  /** So the page can move focus to the intent field (the palette's "New mandate"). */
  intentRef: React.RefObject<HTMLTextAreaElement>;
}): React.ReactElement {
  const run = useOsdkAction(runMandateSearchAction);
  const [intent, setIntent] = React.useState("");
  const [archetype, setArchetype] = React.useState<(typeof ARCHETYPES)[number]>("CF");
  const [priority, setPriority] = React.useState<(typeof PRIORITIES)[number]>("High");

  const canSubmit = intent.trim() !== "" && !run.isPending;

  const onRun = (): void => {
    // runMandateSearchAction does not yet accept intentStatement, so the sentence goes as `title`
    // (the only free-text create param); the cards read `intentStatement ?? title`. Geography and
    // max-size are deprecated on the mandate and are not written.
    void run
      .applyAction({ title: intent.trim(), archetype, priority })
      .then(() => setIntent(""))
      .catch(() => undefined);
  };

  return (
    <Panel className={styles.form} aria-label="New mandate">
      <h2 className={styles.kicker}>New mandate</h2>

      <div className={styles.field}>
        <label htmlFor="mandate-intent" className={styles.label}>
          Intent statement
        </label>
        <Textarea
          id="mandate-intent"
          ref={intentRef}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g. European firms with a specialty in capital solutions"
          rows={3}
        />
        <p className={styles.hint}>
          Geography, size, and other filters live on the Search. Set them via Interpret &amp; run
          search after creating the mandate.
        </p>
      </div>

      <div className={styles.field}>
        <div id="mandate-archetype-label" className={styles.label}>
          Archetype
        </div>
        <Segmented<(typeof ARCHETYPES)[number]>
          block
          ariaLabelledBy="mandate-archetype-label"
          options={ARCHETYPES.map((a) => ({ label: a, value: a }))}
          value={archetype}
          onChange={setArchetype}
        />
        <p className={styles.hint}>
          <Term id="CF">CF</Term> corporate finance · <Term id="CS">CS</Term> capital solutions
        </p>
      </div>

      <div className={styles.field}>
        <div id="mandate-priority-label" className={styles.label}>
          Priority
        </div>
        <Segmented<(typeof PRIORITIES)[number]>
          block
          ariaLabelledBy="mandate-priority-label"
          options={PRIORITIES.map((p) => ({ label: p, value: p }))}
          value={priority}
          onChange={setPriority}
        />
      </div>

      {run.error !== undefined && <Notice>{String(run.error)}</Notice>}

      <Button variant="primary" disabled={!canSubmit} onClick={onRun}>
        {run.isPending ? "Creating mandate…" : "Create mandate"}
      </Button>
    </Panel>
  );
}
