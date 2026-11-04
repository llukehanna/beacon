import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActionFailedError, resetDemo } from "@/data/api";

const RATE_LIMITED_MESSAGE = "The demo was reset in the last few minutes — try again shortly.";

function failureMessage(e: unknown): string {
  if (e instanceof ActionFailedError && e.status === 429) {
    return RATE_LIMITED_MESSAGE;
  }
  return e instanceof Error ? e.message : String(e);
}

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.4,
  color: "color-mix(in srgb, var(--color-text) 48%, transparent)",
};

/**
 * Bottom-of-sidebar notice that this is a shared demo on synthetic data, with a throttled reset.
 * Reset is destructive for every visitor, so it asks first in a small popover: focus moves to
 * Cancel, Tab stays inside, and Escape cancels and returns focus to the Reset button.
 */
export default function DemoFooter(): React.ReactElement {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error: boolean } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
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
        close();
      } else if (e.key === "Tab") {
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
    <div
      ref={wrapRef}
      aria-label="Demo notice"
      role="group"
      style={{
        position: "relative",
        flex: "none",
        marginTop: "auto",
        paddingTop: 12,
        borderTop: "1px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span style={noteStyle}>Demo · synthetic data · resets daily</span>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary"
        aria-haspopup="dialog"
        aria-expanded={confirming}
        disabled={busy}
        onClick={() => setConfirming((v) => !v)}
      >
        {busy ? "Resetting…" : "Reset demo"}
      </button>
      {/* Always mounted so screen readers announce changes. */}
      <span
        role="status"
        style={{
          ...noteStyle,
          color: message?.error ? "#f4abab" : noteStyle.color,
        }}
      >
        {message?.text ?? ""}
      </span>
      {confirming && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "calc(100% + 8px)",
            zIndex: 20,
            boxSizing: "border-box",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface)",
            border: "1px solid color-mix(in srgb, var(--color-text) 22%, transparent)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
          }}
        >
          <div id={titleId} style={{ fontSize: 13, fontWeight: 600 }}>
            Reset the demo for everyone?
          </div>
          <div
            id={bodyId}
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: "color-mix(in srgb, var(--color-text) 72%, transparent)",
            }}
          >
            This restores the seeded data and clears all changes made since the last reset.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn-primary"
              onClick={() => void onConfirm()}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
