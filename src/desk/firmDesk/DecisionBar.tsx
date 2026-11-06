import React from "react";
import { Term } from "@/components/Term";
import { useObservableClient, useOsdkAction } from "@/data/hooks";
import { advanceStageAction, qualifyFirmAction, rejectFirmAction } from "@/data/ontology";
import { type Command, useCommands } from "@/shell/commands";
import {
  FIRM_DECISION_KEYS,
  type FirmDecisionKey,
  firmDecisionKey,
  isTypingTarget,
} from "@/shell/keys";
import { Button, Kbd } from "@/ui";
import { type MirrorResult } from "../scoreMirror";
import styles from "./DecisionBar.module.css";
import { confirmItems, firmDecisionState } from "./decisionState";
import { type EditMap, type FirmView, formatActionError } from "./deskModel";
import { otherDialogOpen } from "./dialogs";

const NOTE_ID = "decision-note";
const NOTE_ERROR_ID = "decision-note-error";

/** Inline, readable action errors: what failed, and that nothing typed was lost. */
function ErrorList({
  errors,
}: {
  errors: Array<{ label: string; error: unknown }>;
}): React.ReactElement | null {
  const shown = errors.filter((e) => e.error !== undefined);
  if (shown.length === 0) {
    return null;
  }
  return (
    <div role="alert" className={styles.error}>
      <strong>Couldn&rsquo;t save your decision.</strong> Your note is kept.
      <ul>
        {shown.map((e) => (
          <li key={e.label}>
            {e.label}: {formatActionError(e.error)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Desk's "Your call": a bar pinned to the bottom of the main column. It lists what to confirm
 * before advancing and offers the firm-level decisions: Commit enrichment, Qualify or Advance, and
 * Pass (which needs a note). The decisions are Shift chords (⇧Q, ⇧A, ⇧R) so they never collide
 * with the plain letters that act on the selected axis; the same chords are in the `?` overlay.
 */
export function DecisionBar({
  firm,
  actionFirm,
  mirror,
  edits,
  onCommit,
  dirty,
  enrichPending,
  enrichError,
}: {
  firm: FirmView;
  actionFirm: unknown;
  /** The score mirror with staged edits applied. */
  mirror: MirrorResult;
  edits: EditMap;
  onCommit: () => void;
  dirty: boolean;
  enrichPending: boolean;
  enrichError: unknown;
}): React.ReactElement {
  const qualify = useOsdkAction(qualifyFirmAction);
  const reject = useOsdkAction(rejectFirmAction);
  const advance = useOsdkAction(advanceStageAction);
  const observable = useObservableClient();
  const noteRef = React.useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = React.useState("");
  // The missing-note error waits for a Pass attempt; it isn't shown on first sight of the form.
  const [attemptedPass, setAttemptedPass] = React.useState(false);
  const firmKey = firm.firmId;
  React.useEffect(() => {
    // A note written for one firm is not a rationale for the next.
    setNote("");
    setAttemptedPass(false);
  }, [firmKey]);

  // Function-backed actions report their created objects (the ReviewDecision) but not reliably
  // the firm they modified, so the automatic cache invalidation would leave the header on its
  // stale lifecycle and this bar offering a transition the server has already completed.
  // Invalidate the firm explicitly after every successful decision.
  const refreshFirm = React.useCallback((): void => {
    void observable.invalidateObjects(actionFirm as never);
  }, [observable, actionFirm]);

  const { stageLabel, terminalKind, qualified, nextState } = firmDecisionState(firm);
  const canQualify = terminalKind === null && !qualified && !qualify.isPending;
  const canAdvance = terminalKind === null && qualified && nextState !== null && !advance.isPending;
  const canPass = terminalKind === null && !reject.isPending;

  const onQualify = (): void => {
    void qualify.applyAction({ firm: actionFirm } as never).then(refreshFirm);
  };
  const onAdvance = (): void => {
    if (nextState === null) {
      return;
    }
    void advance
      .applyAction({ firm: actionFirm, targetState: nextState } as never)
      .then(refreshFirm);
  };
  const onPass = (): void => {
    if (note.trim().length === 0) {
      setAttemptedPass(true);
      noteRef.current?.focus();
      return;
    }
    // Note preserved if the pass fails (only cleared on success).
    void reject
      .applyAction({ firm: actionFirm, rejectionRationale: note.trim() } as never)
      .then(() => {
        setNote("");
        setAttemptedPass(false);
        refreshFirm();
      });
  };

  // One place that says what each shortcut does right now; the key listener and the palette
  // commands both go through it, so a key that is not offered does nothing.
  const act = {
    qualify: canQualify ? onQualify : null,
    advance: canAdvance ? onAdvance : null,
    pass: canPass ? onPass : null,
  } satisfies Record<FirmDecisionKey, (() => void) | null>;
  const actRef = React.useRef(act);
  actRef.current = act;
  const commitRef = React.useRef<(() => void) | null>(null);
  const canCommit = dirty && !enrichPending;
  commitRef.current = canCommit ? onCommit : null;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || isTypingTarget(e.target as Element | null) || otherDialogOpen()) {
        return;
      }
      const key = firmDecisionKey(e);
      const run = key === null ? null : actRef.current[key];
      if (run !== null) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = React.useMemo<Command[]>(() => {
    const list: Command[] = [];
    // Offered only while there is something staged to commit, like the button and the shortcut.
    if (canCommit) {
      list.push({
        id: "desk:commit",
        label: "Commit enrichment",
        group: "Actions",
        hint: "⌘↵",
        run: () => commitRef.current?.(),
      });
    }
    if (canQualify) {
      list.push({
        id: "desk:qualify",
        label: "Qualify firm",
        group: "Actions",
        hint: FIRM_DECISION_KEYS.qualify.label,
        run: () => actRef.current.qualify?.(),
      });
    }
    if (canAdvance) {
      list.push({
        id: "desk:advance",
        label: `Advance to ${nextState}`,
        group: "Actions",
        hint: FIRM_DECISION_KEYS.advance.label,
        run: () => actRef.current.advance?.(),
      });
    }
    if (canPass) {
      list.push({
        id: "desk:pass",
        label: "Pass on this firm",
        group: "Actions",
        hint: FIRM_DECISION_KEYS.pass.label,
        run: () => actRef.current.pass?.(),
      });
    }
    return list;
  }, [canCommit, canQualify, canAdvance, canPass, nextState]);
  useCommands(commands);

  const items = confirmItems(firm, mirror, edits);
  const done = items.filter((i) => i.ok).length;
  const noteMissing = attemptedPass && note.trim() === "";
  const noteHint =
    terminalKind !== null
      ? "No decision actions are available in a terminal state."
      : noteMissing
        ? "A note is required to pass."
        : note.trim() === ""
          ? "Add a note to pass on this firm."
          : "Note captured as the pass rationale.";

  return (
    <section className={styles.bar} aria-label="Your call">
      <ErrorList
        errors={[
          { label: "Commit", error: enrichError },
          { label: "Qualify", error: qualify.error },
          { label: "Advance", error: advance.error },
          { label: "Pass", error: reject.error },
        ]}
      />

      <div className={styles.main}>
        <div className={styles.confirm}>
          <div className={styles.heading}>
            <h2 className={styles.title}>Confirm before advancing</h2>
            <span className={styles.count} aria-label={`${done} of ${items.length} confirmed`}>
              {done}/{items.length}
            </span>
          </div>
          <ul className={styles.items}>
            {items.map((it) => (
              <li key={it.id} data-ok={it.ok ? "true" : "false"}>
                <span className={styles.mark} aria-hidden="true">
                  {it.ok ? "✓" : "–"}
                </span>
                <span>
                  {it.id === "gates" ? (
                    <>
                      <Term id="Hard gate">Hard gates</Term> recorded
                    </>
                  ) : (
                    it.label
                  )}
                  <span className={styles.sr}>{it.ok ? ": confirmed" : ": not yet"}</span>
                </span>
                <span className={styles.detail}>{it.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.noteBox}>
          <label htmlFor={NOTE_ID} className={styles.sr}>
            Decision note
          </label>
          <textarea
            id={NOTE_ID}
            ref={noteRef}
            className={styles.note}
            value={note}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteMissing}
            aria-describedby={NOTE_ERROR_ID}
            placeholder={
              terminalKind === null
                ? "Decision note. Optional for advance and qualify · required to pass…"
                : "Firm is in a terminal state. Notes here won't be attached to a decision."
            }
          />
          <p
            id={NOTE_ERROR_ID}
            role={noteMissing ? "alert" : undefined}
            className={`${styles.hint} ${noteMissing ? styles.hintError : ""}`}
          >
            {noteHint}
          </p>
        </div>

        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={!dirty || enrichPending}
            onClick={onCommit}
            title="Save verified state without moving the firm"
          >
            {enrichPending ? "Saving…" : "Commit enrichment"} <Kbd>⌘↵</Kbd>
          </Button>
          {terminalKind === null ? (
            <>
              {qualified ? (
                <Button
                  disabled={!canAdvance}
                  onClick={onAdvance}
                  // Canonical explanation first, then the specific target the analyst is about
                  // to move this firm to.
                  title={
                    nextState === null
                      ? `${stageLabel} is the final stage. No further advance available.`
                      : `Move one stage down the pipeline: ${stageLabel} to ${nextState}`
                  }
                >
                  {advance.isPending
                    ? "Advancing…"
                    : nextState !== null
                      ? `Advance → ${nextState}`
                      : `${stageLabel} · no next stage`}
                  {nextState !== null && <Kbd>{FIRM_DECISION_KEYS.advance.label}</Kbd>}
                </Button>
              ) : (
                <Button disabled={!canQualify} onClick={onQualify} title="Accept into the funnel">
                  {qualify.isPending ? "Qualifying…" : "Qualify firm"}{" "}
                  <Kbd>{FIRM_DECISION_KEYS.qualify.label}</Kbd>
                </Button>
              )}
              <Button
                className={styles.pass}
                data-tour="pass-button"
                disabled={!canPass}
                onClick={onPass}
                title="Pass on this firm. A decision note is required."
              >
                {reject.isPending ? "Passing…" : "Pass…"} <Kbd>{FIRM_DECISION_KEYS.pass.label}</Kbd>
              </Button>
            </>
          ) : (
            <p
              className={styles.terminal}
              title="Advance, Qualify, and Pass are unavailable once a firm is Passed or Closed."
            >
              Terminal state · {terminalKind === "closed" ? "Closed" : stageLabel}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
