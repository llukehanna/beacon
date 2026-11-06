import React from "react";
import { Dialog, DialogBody } from "@blueprintjs/core";
import { useTour } from "@/tour/tourContext";
import { Button, Kbd } from "@/ui";
import styles from "./ShortcutsOverlay.module.css";
import { FIRM_DECISION_KEYS, NAV_ITEMS } from "./keys";

interface Row {
  keys: string[];
  label: string;
}

const GO_ROWS: Row[] = NAV_ITEMS.map((n) => ({
  keys: ["G", n.key.toUpperCase()],
  label: n.label,
}));

// Every key listed here is bound. Plain letters act on the selected axis; Shift chords decide the
// whole firm (see FIRM_DECISION_KEYS).
const DESK_ROWS: Row[] = [
  { keys: ["↑", "↓"], label: "Move between axes" },
  { keys: ["0", "1", "2"], label: "Choose the selected axis's option" },
  { keys: ["P", "F"], label: "Pass or fail the selected gate" },
  { keys: ["V"], label: "Verify the proposed value" },
  { keys: ["R"], label: "Reject the proposed value and enter your own" },
  { keys: ["⌘↵"], label: "Commit enrichment" },
  { keys: [FIRM_DECISION_KEYS.qualify.label], label: "Qualify the firm" },
  { keys: [FIRM_DECISION_KEYS.advance.label], label: "Advance the firm to its next stage" },
  { keys: [FIRM_DECISION_KEYS.pass.label], label: "Pass on the firm (a note is required)" },
  { keys: ["Esc"], label: "Clear focus" },
];

function Section({ title, rows }: { title: string; rows: Row[] }): React.ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={styles.title}>{title}</h3>
      <dl className={styles.list}>
        {rows.map((r) => (
          <div key={r.label} className={styles.row}>
            <dt>{r.label}</dt>
            <dd>
              {r.keys.map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && r.keys[0] === "G" && <span className={styles.then}>then</span>}
                  <Kbd>{k}</Kbd>
                </React.Fragment>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The keyboard shortcuts, opened with `?`. */
export default function ShortcutsOverlay({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { start } = useTour();
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard shortcuts"
      className={`bp6-dark ${styles.dialog}`}
    >
      <DialogBody>
        <div className={styles.columns}>
          <div>
            <Section title="Go to" rows={GO_ROWS} />
            <Section title="Anywhere" rows={[{ keys: ["?"], label: "Show this list" }]} />
            <Button
              className={styles.tour}
              onClick={() => {
                onClose();
                start();
              }}
            >
              Take the 60-second tour
            </Button>
          </div>
          <Section title="On the Desk" rows={DESK_ROWS} />
        </div>
      </DialogBody>
    </Dialog>
  );
}
