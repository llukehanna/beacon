import React from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ActionFailedError, resetDemo } from "@/data/api";
import { Button, Kbd } from "@/ui";
import styles from "./StatusBar.module.css";
import { type SyncSummary, summarizeSync, syncedAgo } from "./status";
import type { ShellCounts } from "./useShellData";

const RATE_LIMITED_MESSAGE = "The demo was reset in the last few minutes — try again shortly.";

function failureMessage(e: unknown): string {
  if (e instanceof ActionFailedError && e.status === 429) {
    return RATE_LIMITED_MESSAGE;
  }
  return e instanceof Error ? e.message : String(e);
}

/** The whole query cache as one status; re-read whenever any query settles. */
function useSyncSummary(): SyncSummary {
  const cache = useQueryClient().getQueryCache();
  // useSyncExternalStore needs a stable snapshot, so the summary travels as a string.
  const snapshot = React.useSyncExternalStore(
    (notify) => cache.subscribe(notify),
    () => {
      const s = summarizeSync(cache.getAll().map((q) => q.state));
      return `${s.lastSyncedAt ?? ""}|${s.unreachable ? 1 : 0}`;
    },
  );
  const [at, bad] = snapshot.split("|");
  return { lastSyncedAt: at === "" ? null : Number(at), unreachable: bad === "1" };
}

/** Seconds-resolution clock for the "Synced Ns ago" text; stops ticking when the tab is hidden. */
function useNow(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Reset-the-demo control. Reset is destructive for every visitor, so it asks first in a small
 * popover: focus moves to Cancel, Tab stays inside, and Escape cancels and returns focus to the
 * Reset button.
 */
function ResetDemo(): React.ReactElement {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error: boolean } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const titleId = React.useId();
  const bodyId = React.useId();

  React.useEffect(() => {
    if (!confirming) {
      return undefined;
    }
    cancelRef.current?.focus();
    // A press outside the popover dismisses it; focus goes wherever the user pressed.
    const onPointerDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node | null)) {
        setConfirming(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [confirming]);

  // The Reset button is disabled while the reset runs, which drops focus to <body>; hand it back
  // when the reset finishes (success or error), unless the user has moved on to something else.
  const wasBusy = React.useRef(false);
  React.useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (wasBusy.current) {
      wasBusy.current = false;
      const active = document.activeElement;
      if (active === null || active === document.body) {
        triggerRef.current?.focus();
      }
    }
  }, [busy]);

  // The floating note is transient; it clears itself.
  React.useEffect(() => {
    if (message === null) {
      return undefined;
    }
    const t = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(t);
  }, [message]);

  const close = React.useCallback((): void => {
    setConfirming(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!confirming) {
      return undefined;
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Tab") {
        e.stopPropagation();
        // Two buttons: wrap focus between them so it never leaves the open popover.
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming, close]);

  const onConfirm = async (): Promise<void> => {
    close();
    setBusy(true);
    setMessage(null);
    try {
      await resetDemo();
      await qc.invalidateQueries();
      setMessage({ text: "Demo data restored.", error: false });
    } catch (e) {
      setMessage({ text: failureMessage(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span ref={wrapRef} className={styles.reset}>
      <span className={styles.note}>Demo data · resets daily</span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.resetButton}
        aria-label="Reset demo"
        aria-haspopup="dialog"
        aria-expanded={confirming}
        disabled={busy}
        onClick={() => setConfirming((v) => !v)}
      >
        {busy ? "Resetting…" : "Reset"}
      </button>
      {/* Always mounted so screen readers announce changes; the visible note floats above the
          bar so it stays one line tall. */}
      <span
        role="status"
        className={message === null || confirming ? styles.srOnly : styles.toast}
        data-error={message?.error === true ? "" : undefined}
      >
        {message?.text ?? ""}
      </span>
      {confirming && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className={styles.popover}
        >
          <div id={titleId} className={styles.popoverTitle}>
            Reset the demo for everyone?
          </div>
          <div id={bodyId} className={styles.popoverBody}>
            This restores the seeded data and clears all changes made since the last reset.
          </div>
          <div className={styles.popoverActions}>
            <Button ref={cancelRef} variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button ref={confirmRef} variant="primary" onClick={() => void onConfirm()}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </span>
  );
}

const DESK_HINTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["↑", "↓"], label: "move between axes" },
  { keys: ["⌘↵"], label: "commit" },
];

const GO_HINTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["G"], label: "then a letter to go" },
];

/**
 * 30 px status bar: how fresh the data is (amber when the server cannot be reached), the queue and
 * review counts, the demo notice with its reset, and the shortcuts that matter on this screen.
 */
export default function StatusBar({ counts }: { counts: ShellCounts }): React.ReactElement {
  const { pathname } = useLocation();
  const { lastSyncedAt, unreachable } = useSyncSummary();
  const now = useNow();
  const hints = [...(pathname === "/desk" ? DESK_HINTS : GO_HINTS), { keys: ["?"], label: "all" }];

  return (
    <footer className={styles.bar} aria-label="Status">
      {/* Only the failure is announced; the ticking age is not a live region. */}
      <span className={styles.sync} data-state={unreachable ? "down" : "up"}>
        <span aria-live="polite" aria-atomic="true">
          {unreachable && (
            <>
              <span aria-hidden="true">●</span> Can&apos;t reach server
            </>
          )}
        </span>
        {!unreachable && (
          <>
            <span aria-hidden="true">●</span>{" "}
            {lastSyncedAt === null ? "Connecting…" : `Synced ${syncedAgo(now - lastSyncedAt)}`}
          </>
        )}
      </span>
      {counts.open !== undefined && counts.review !== undefined && (
        <span className={styles.counts}>
          {counts.open} open firm{counts.open === 1 ? "" : "s"} · {counts.review} need review
        </span>
      )}
      <ResetDemo />
      <span className={styles.hints}>
        {hints.map((h) => (
          <span key={h.label}>
            {h.keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}{" "}
            {h.label}
          </span>
        ))}
      </span>
    </footer>
  );
}
