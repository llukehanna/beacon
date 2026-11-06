import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import styles from "./MenuButton.module.css";

export interface MenuItem {
  id: string;
  label: ReactNode;
  /** A quieter second line under the label. */
  hint?: ReactNode;
  onSelect: () => void;
}

/**
 * A button that opens a short list of actions. Arrow keys, Home and End move between items,
 * Escape and Tab close it (Escape puts focus back on the button) and a click outside closes it.
 */
export function MenuButton({
  label,
  items,
  disabled,
  busy,
  variant,
}: {
  label: ReactNode;
  items: readonly MenuItem[];
  disabled?: boolean;
  /** Work in progress: the button stays focusable (aria-disabled) but does not open. */
  busy?: boolean;
  variant?: "default" | "primary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      button.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (i: number): void => {
      e.preventDefault();
      entries[(i + entries.length) % entries.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(entries.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div className={styles.wrap} ref={wrap}>
      <Button
        ref={button}
        variant={variant}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        aria-controls={open ? menuId : undefined}
        onClick={() => busy !== true && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open && busy !== true) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </Button>
      {open && (
        <div id={menuId} role="menu" tabIndex={-1} className={styles.menu} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
              {item.hint !== undefined && <span className={styles.hint}>{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
