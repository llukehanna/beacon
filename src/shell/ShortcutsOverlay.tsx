import React from "react";
import { Dialog, DialogBody } from "@blueprintjs/core";
import { Kbd } from "@/ui";
import styles from "./ShortcutsOverlay.module.css";
import { NAV_ITEMS } from "./keys";

interface Row {
  keys: string[];
  label: string;
}

const GO_ROWS: Row[] = NAV_ITEMS.map((n) => ({
  keys: ["G", n.key.toUpperCase()],
  label: n.label,
}));

const DESK_ROWS: Row[] = [
  { keys: ["↑", "↓"], label: "Move between axes" },
  { keys: ["0", "1", "2"], label: "Choose the focused axis's option" },
  { keys: ["P", "F"], label: "Pass or fail the focused gate" },
  { keys: ["⌘↵"], label: "Commit enrichment" },
  { keys: ["Esc"], label: "Clear the focused axis" },
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
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard shortcuts"
      className="bp6-dark"
      portalClassName="dsn"
    >
      <DialogBody>
        <Section title="Go to" rows={GO_ROWS} />
        <Section title="On the Desk" rows={DESK_ROWS} />
        <Section title="Anywhere" rows={[{ keys: ["?"], label: "Show this list" }]} />
      </DialogBody>
    </Dialog>
  );
}
