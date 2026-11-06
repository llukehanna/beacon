import React from "react";
import { useOsdkAction } from "@/data/hooks";
import {
  acknowledgeDriftAction,
  keepPassedAction,
  reEngageFirmAction,
  rejectFirmAction,
} from "@/data/ontology";
import { type Command, useCommands } from "@/shell/commands";
import { Button } from "@/ui";
import styles from "./DriftActions.module.css";
import { type DriftItem } from "./driftModel";

/**
 * The decisions on an open drift event. A passed firm can be re-engaged or kept passed (with a
 * rationale); a firm still in the pipeline can be kept there or passed (with a rationale). Nothing
 * is offered until the firm has loaded, or for a firm at a stage with no decision to make.
 */
export function DriftActions({ item }: { item: DriftItem }): React.ReactElement | null {
  const { drift, firm, kind, canPass, firmName } = item;
  const reEngage = useOsdkAction(reEngageFirmAction);
  const keepPassed = useOsdkAction(keepPassedAction);
  const acknowledge = useOsdkAction(acknowledgeDriftAction);
  const pass = useOsdkAction(rejectFirmAction);
  const [notePanel, setNotePanel] = React.useState<"keepPassed" | "pass" | null>(null);
  const [note, setNote] = React.useState("");

  const closeNotePanel = (): void => {
    setNote("");
    setNotePanel(null);
  };
  // Each decision is applied once; a failure stays on screen (and the note with it).
  const onReEngage = (): void => {
    void reEngage.applyAction({ firm, driftEvent: drift } as never).catch(() => undefined);
  };
  const onAcknowledge = (): void => {
    void acknowledge.applyAction({ driftEvent: drift, note: null } as never).catch(() => undefined);
  };
  const onKeepPassed = (): void => {
    void keepPassed
      .applyAction({ driftEvent: drift, rationale: note.trim() } as never)
      .then(closeNotePanel)
      .catch(() => undefined);
  };
  const onPass = (): void => {
    void pass
      .applyAction({ firm, rejectionRationale: note.trim() } as never)
      .then(closeNotePanel)
      .catch(() => undefined);
  };

  // The palette runs the latest handlers without being re-registered on every render.
  const latest = React.useRef({ onReEngage, onAcknowledge });
  latest.current = { onReEngage, onAcknowledge };
  const commands = React.useMemo<Command[]>(() => {
    if (kind === "passed") {
      return [
        {
          id: "review:re-engage",
          label: `Re-engage ${firmName}`,
          group: "Actions",
          run: () => latest.current.onReEngage(),
        },
        {
          id: "review:keep-passed",
          label: `Keep ${firmName} passed…`,
          group: "Actions",
          run: () => setNotePanel("keepPassed"),
        },
      ];
    }
    if (kind === "pipeline") {
      return [
        {
          id: "review:keep-in-pipeline",
          label: `Keep ${firmName} in the pipeline`,
          group: "Actions",
          run: () => latest.current.onAcknowledge(),
        },
        ...(canPass
          ? [
              {
                id: "review:pass",
                label: `Pass on ${firmName}…`,
                group: "Actions" as const,
                run: () => setNotePanel("pass"),
              },
            ]
          : []),
      ];
    }
    return [];
  }, [kind, canPass, firmName]);
  useCommands(commands);

  if (kind === null) {
    return null;
  }

  const noteSubmitting = notePanel === "keepPassed" ? keepPassed.isPending : pass.isPending;
  const canSubmitNote = note.trim().length > 0 && !noteSubmitting;
  const busy = reEngage.isPending || acknowledge.isPending || noteSubmitting;
  const failures: string[] = [
    reEngage.error !== undefined ? `Re-engage failed: ${String(reEngage.error)}` : "",
    acknowledge.error !== undefined ? `Keep in pipeline failed: ${String(acknowledge.error)}` : "",
    keepPassed.error !== undefined
      ? `Keep passed failed: ${String(keepPassed.error)}. Your note is preserved.`
      : "",
    pass.error !== undefined ? `Pass failed: ${String(pass.error)}. Your note is preserved.` : "",
  ].filter((m) => m !== "");

  return (
    <div className={styles.actions}>
      {failures.length > 0 && (
        <div role="alert" className={styles.failure}>
          {failures.map((m) => (
            <div key={m}>{m}</div>
          ))}
        </div>
      )}

      {notePanel === null ? (
        <div className={styles.buttons}>
          {kind === "passed" ? (
            <>
              <Button variant="primary" disabled={busy} onClick={onReEngage}>
                {reEngage.isPending ? "Re-engaging…" : "Re-engage"}
              </Button>
              <Button disabled={busy} onClick={() => setNotePanel("keepPassed")}>
                Keep passed…
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={busy} onClick={onAcknowledge}>
                {acknowledge.isPending ? "Keeping…" : "Keep in pipeline"}
              </Button>
              {canPass && (
                <Button disabled={busy} onClick={() => setNotePanel("pass")}>
                  Pass…
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className={styles.noteForm}>
          <div className={styles.hint} id="drift-note-hint">
            {notePanel === "keepPassed"
              ? "A rationale is required to keep this firm passed."
              : "A rationale is required to pass on this firm."}
          </div>
          <textarea
            className={styles.note}
            aria-describedby="drift-note-hint"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              notePanel === "keepPassed"
                ? "Why keep this firm passed despite the drift?"
                : "Why pass on this firm after the drift?"
            }
            aria-label={
              notePanel === "keepPassed"
                ? "Reason to keep this firm passed"
                : "Reason to pass on this firm"
            }
          />
          <div className={styles.buttons}>
            <Button
              variant="primary"
              disabled={!canSubmitNote}
              onClick={notePanel === "keepPassed" ? onKeepPassed : onPass}
            >
              {notePanel === "keepPassed"
                ? keepPassed.isPending
                  ? "Keeping…"
                  : "Keep passed"
                : pass.isPending
                  ? "Passing…"
                  : "Pass firm"}
            </Button>
            <Button variant="ghost" onClick={closeNotePanel} disabled={noteSubmitting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
