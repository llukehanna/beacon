import React from "react";
import { Dialog } from "@blueprintjs/core";
import { Search } from "@blueprintjs/icons";
import { Kbd } from "@/ui";
import styles from "./CommandPalette.module.css";
import { type Command, paletteSections } from "./commands";
import type { FirmStatus } from "./useShellCommands";

function Body({
  commands,
  firmCount,
  firmStatus,
  onClose,
}: {
  commands: readonly Command[];
  firmCount: number | undefined;
  firmStatus: FirmStatus;
  onClose: () => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const sections = React.useMemo(() => paletteSections(query, commands), [query, commands]);
  const flat = React.useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  const optionId = (i: number): string => `palette-option-${i}`;

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    listRef.current?.querySelector(`#${optionId(current)}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current, sections]);

  const run = (cmd: Command | undefined): void => {
    if (cmd === undefined) {
      return;
    }
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length > 0) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((current + step + flat.length) % flat.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(flat[current]);
    }
  };

  let index = -1;
  return (
    <>
      <h2 id="palette-title" className={styles.sr}>
        Command palette
      </h2>
      <div className={styles.field}>
        <Search size={15} className={styles.icon} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={flat.length > 0 ? optionId(current) : undefined}
          aria-label="Search firms, routes and actions"
          placeholder="Search firms, routes and actions…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd listed>Esc</Kbd>
      </div>
      <div ref={listRef} id="palette-list" role="listbox" className={styles.list}>
        {sections.map((section) => (
          <div key={section.group} role="group" aria-label={section.group}>
            <div className={styles.group} aria-hidden="true">
              {section.group}
            </div>
            {section.items.map((item) => {
              index += 1;
              const i = index;
              return (
                // The input owns the keyboard (combobox pattern), so the options take clicks only.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                <div
                  key={item.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === current}
                  className={styles.item}
                  data-active={i === current ? "true" : undefined}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(item)}
                >
                  <span className={styles.label}>{item.label}</span>
                  {item.hint !== undefined && <span className={styles.hint}>{item.hint}</span>}
                </div>
              );
            })}
          </div>
        ))}
        {query.trim() !== "" && firmStatus === "loading" && (
          <p className={flat.length === 0 ? styles.empty : styles.note} role="status">
            Loading firms…
          </p>
        )}
        {query.trim() !== "" && firmStatus === "error" && (
          <p className={flat.length === 0 ? styles.empty : styles.note} role="status">
            Couldn’t load firms. Routes and mandates still work.
          </p>
        )}
        {flat.length === 0 &&
          (query.trim() === "" || firmStatus === "ready" || firmStatus === "idle") && (
            <p className={styles.empty} role="status">
              No match for “{query.trim()}”.
            </p>
          )}
      </div>
      <div className={styles.foot} aria-hidden="true">
        <span>
          <Kbd listed>↑</Kbd> <Kbd listed>↓</Kbd> move
        </span>
        <span>
          <Kbd listed>↵</Kbd> open
        </span>
        {query.trim() === "" && firmCount !== undefined && (
          <span className={styles.count}>Type to search {firmCount} firms</span>
        )}
      </div>
    </>
  );
}

/** The ⌘K palette: one search box over firms, routes, mandates and the current screen's actions. */
export default function CommandPalette({
  commands,
  firmCount,
  firmStatus,
  isOpen,
  onClose,
}: {
  commands: readonly Command[];
  firmCount: number | undefined;
  firmStatus: FirmStatus;
  isOpen: boolean;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      className={`bp6-dark ${styles.dialog}`}
      aria-labelledby="palette-title"
      canOutsideClickClose
    >
      <Body commands={commands} firmCount={firmCount} firmStatus={firmStatus} onClose={onClose} />
    </Dialog>
  );
}
