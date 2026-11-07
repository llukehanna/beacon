import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setPersona, usePersona } from "@/data/persona";
import { PERSONAS, PERSONA_LABELS, isPersona } from "../../shared/accessPolicy";
import styles from "./PersonaSwitcher.module.css";

/**
 * Who the demo is viewed as: analyst, deal-team lead or compliance. The choice is sent with every
 * request and decides what the server returns (restricted firms, mandate names). It is demo-only:
 * anyone can switch, and nothing here is a login. Switching refetches everything on screen.
 */
export default function PersonaSwitcher(): React.ReactElement {
  const persona = usePersona();
  const qc = useQueryClient();
  const selectId = React.useId();
  const noteId = React.useId();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    if (isPersona(e.target.value)) {
      setPersona(e.target.value);
      // Drop what the last persona was shown and fetch again as the new one.
      void qc.resetQueries();
    }
  };

  return (
    <div className={styles.persona}>
      <label htmlFor={selectId} className={styles.label}>
        <span>Viewing as</span>
        <span className={styles.demo}>Demo</span>
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={persona}
        onChange={onChange}
        aria-describedby={noteId}
      >
        {PERSONAS.map((p) => (
          <option key={p} value={p}>
            {PERSONA_LABELS[p]}
          </option>
        ))}
      </select>
      <p id={noteId} className={styles.note}>
        Anyone can switch. This is not a login.
      </p>
    </div>
  );
}
