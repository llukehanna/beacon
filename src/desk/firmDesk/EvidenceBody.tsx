import React from "react";
import { useOsdkAction } from "@/data/hooks";
import { resolveConflictAction } from "@/data/ontology";
import { type Command, useCommands } from "@/shell/commands";
import { isTypingTarget } from "@/shell/keys";
import { Button, Chip, Kbd, StatusPill } from "@/ui";
import { PROVIDER_TRUST, providerLabel } from "../../../shared/vocab";
import { type FindingLike } from "../axisState";
import {
  type AcceptDecision,
  FINDING_AXIS_TO_KEY,
  coerceFindingValue,
  decideVerify,
  displayFindingValue,
  formatAxisValue,
} from "../findingActions";
import { type Model } from "../scoreMirror";
import { excerptText, modelChipTitle, modelLabel } from "../sourceHighlight";
import styles from "./EvidenceBody.module.css";
import { SourceView } from "./SourceView";
import { ValueEditor } from "./ValueEditor";
import { type AxisRow, authoritativeFinding } from "./axisRows";
import {
  type EditMap,
  formatActionError,
  formatRetrievedShort,
  stringifyOverride,
} from "./deskModel";
import { otherDialogOpen } from "./dialogs";
import {
  conflictSides,
  evidenceChecks,
  isAnalystEntered,
  pickReading,
  rejectReasonText,
} from "./evidenceModel";
import { type OnFile } from "./onFile";

type Staged = string | number | boolean;

const confidenceText = (tier: string | undefined): string | null => {
  const t = (tier ?? "").toLowerCase();
  return t === "high" ? "High confidence" : t === "low" ? "Low confidence" : null;
};

const sourceName = (f: FindingLike): string => {
  const raw = f.provider ?? "";
  return raw === "" || raw === "none" || raw === "unknown" ? "Analyst" : providerLabel(raw);
};

/** The inline "you set X, the agent proposes Y" choice, shown when verifying would overwrite. */
interface Prompt {
  mine: Staged;
  theirs: Staged;
  editKey: string;
}

function Checks({
  row,
  reading,
}: {
  row: AxisRow;
  reading: NonNullable<ReturnType<typeof pickReading>>;
}): React.ReactElement {
  const checks = evidenceChecks(row.def, reading);
  return (
    <div>
      {reading.grounded === false && (
        <p className={styles.turnedDown}>
          Turned down: {rejectReasonText(reading.rejectReason ?? "")}
        </p>
      )}
      <ul className={styles.checks} aria-label="Grounding checks">
        {checks.map((c) => (
          <li key={c.id} data-status={c.status}>
            <span className={styles.mark} aria-hidden="true">
              {c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "–"}
            </span>
            <span>
              {c.label}
              <span className={styles.sr}>
                {c.status === "pass"
                  ? ": passed"
                  : c.status === "fail"
                    ? ": failed"
                    : ": not checked"}
              </span>
            </span>
            {c.detail !== null && <span className={styles.detail}>{c.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The selected axis in the evidence panel: its value and who supplied it, the source document
 * with the quote marked, the grounding checks, and every action the finding offers (verify,
 * reject with your own value, accept one side of a conflict, set a value yourself).
 */
export function EvidenceBody({
  row,
  model,
  edits,
  onFile,
  getCurrent,
  applyEdit,
  queueVerify,
  provider,
  onProvider,
}: {
  row: AxisRow;
  model: Model;
  edits: EditMap;
  /** What the firm record holds for this axis, if anything. */
  onFile: OnFile | undefined;
  getCurrent: (editKey: string) => Staged | null | undefined;
  applyEdit: (editKey: string, value: Staged) => void;
  queueVerify: (f: FindingLike, overrideValue?: string) => void;
  /** The provider whose reading is open, when the analyst picked one. */
  provider: string | undefined;
  onProvider: (provider: string) => void;
}): React.ReactElement {
  const editKey = row.def.actionParam;
  const resolve = useOsdkAction(resolveConflictAction);
  const [resolveError, setResolveError] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState<Prompt | null>(null);
  const [unroutable, setUnroutable] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const sides = React.useMemo(() => conflictSides(row), [row]);
  const finding = authoritativeFinding(row);
  const proposed = row.state === "proposed" && finding !== undefined;
  const said = row.readings.filter((r) => r.value !== null);
  // A value the analyst entered (or any finding with no source document) has no source: showing
  // a provider's document and checks under it would present them as its evidence.
  const analystEntered = isAnalystEntered(row.state, finding);
  const reading = analystEntered
    ? undefined
    : ((provider !== undefined ? said.find((r) => r.provider === provider) : undefined) ??
      pickReading(row, finding ?? sides[0]));
  const cited = finding ?? sides[0];
  const source = analystEntered
    ? null
    : reading?.documentId != null
      ? { documentId: reading.documentId, quote: reading.quote }
      : cited?.sourceDocumentId
        ? { documentId: cited.sourceDocumentId, quote: cited.sourceQuote ?? null }
        : null;
  const mineRef = React.useRef<HTMLElement>(null);
  const showEditor = editing || rejecting || row.state === "abstained" || row.state === "empty";

  const verify = (): void => {
    if (finding === undefined) {
      return;
    }
    const decision: AcceptDecision = decideVerify(finding, getCurrent(editKey));
    if (decision.kind === "unroutable") {
      setPrompt(null);
      setUnroutable(
        decision.reason === "unknown-axis"
          ? "This finding's axis doesn't map to a firm field yet."
          : "Finding value can't be routed to this field. Enter it manually.",
      );
      return;
    }
    setUnroutable(null);
    if (decision.kind === "apply") {
      applyEdit(decision.editKey, decision.value);
      queueVerify(finding);
      setPrompt(null);
      return;
    }
    setPrompt({ mine: decision.mine, theirs: decision.theirs, editKey: decision.editKey });
  };

  const keepMine = (): void => {
    if (prompt === null || finding === undefined) {
      return;
    }
    // Keep the analyst's value; the finding records the disagreement.
    queueVerify(finding, stringifyOverride(prompt.editKey, prompt.mine));
    setPrompt(null);
  };

  const takeAgents = (): void => {
    if (prompt === null || finding === undefined) {
      return;
    }
    applyEdit(prompt.editKey, prompt.theirs);
    queueVerify(finding);
    setPrompt(null);
  };

  const rejectWith = (value: Staged): void => {
    if (finding === undefined) {
      return;
    }
    applyEdit(editKey, value);
    queueVerify(finding, stringifyOverride(editKey, value));
    setRejecting(false);
  };

  const accept = async (chosen: FindingLike, other: FindingLike): Promise<void> => {
    setResolveError(null);
    try {
      // The action takes the finding objects themselves (FindingLike is a shape-only cast of
      // the rows the query returned), never ids.
      await resolve.applyAction({
        chosenFinding: chosen,
        rejectedFinding: other,
        chosenValue: chosen.value ?? "",
      } as never);
      // Only once the ontology confirms the resolve is the choice staged on the axis.
      const key = FINDING_AXIS_TO_KEY[(chosen.axis ?? "").trim().toLowerCase()];
      const coerced = key === undefined ? undefined : coerceFindingValue(key, chosen.value);
      if (key !== undefined && coerced !== undefined) {
        applyEdit(key, coerced);
      }
    } catch (e) {
      setResolveError(formatActionError(e));
    }
  };

  // Opening the editor from the footer or the R key brings it into view.
  React.useEffect(() => {
    if (rejecting || editing) {
      mineRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [rejecting, editing]);

  // V verifies the proposed value, R opens the reject-with-your-own-value editor. Shift+R is the
  // decision bar's "Pass" for the whole firm, so a shifted letter is never read here.
  const verifyRef = React.useRef(verify);
  verifyRef.current = verify;
  const commands = React.useMemo<Command[]>(
    () =>
      proposed
        ? [
            {
              id: "desk:verify",
              label: `Verify ${row.label}`,
              group: "Actions",
              hint: "V",
              run: () => verifyRef.current(),
            },
            {
              id: "desk:reject",
              label: `Reject ${row.label} and enter your own`,
              group: "Actions",
              hint: "R",
              run: () => setRejecting(true),
            },
          ]
        : [],
    [proposed, row.label],
  );
  useCommands(commands);
  React.useEffect(() => {
    if (!proposed) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        isTypingTarget(e.target as Element | null) ||
        otherDialogOpen()
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "v") {
        verifyRef.current();
        e.preventDefault();
      } else if (k === "r") {
        setRejecting(true);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [proposed]);

  const valueText =
    finding !== undefined && row.state !== "abstained"
      ? displayFindingValue(row.axis, finding.value)
      : null;
  const confidence = confidenceText(finding?.confidenceTier);
  const modelName = modelLabel(finding?.extractionModel);
  const excerpt = finding !== undefined && !finding.sourceDocumentId ? excerptText(finding) : null;
  const shownExcerpt = row.state === "abstained" ? null : excerpt;
  const earlier = row.findings.filter((f) => f !== finding && !sides.includes(f));
  const errorText = resolve.error !== undefined ? formatActionError(resolve.error) : resolveError;

  return (
    <>
      <div className={styles.body}>
        <div className={styles.label}>
          <span>{row.label}</span>
          {row.state === "empty" ? (
            <span className={styles.none}>No finding</span>
          ) : (
            <StatusPill status={row.state} />
          )}
        </div>

        {onFile !== undefined && (
          <p className={styles.onFile}>
            {onFile.pending ? "Pending" : "On file"}: <span>{onFile.text}</span>
            {onFile.band !== null && ` · scores ${onFile.band} of 2`}
          </p>
        )}

        {row.state === "conflict" ? (
          <div className={styles.sides} role="group" aria-label="Conflicting values">
            {sides.map((f, i) => {
              const other = sides[1 - i];
              const label = sourceName(f);
              const value = displayFindingValue(f.axis, f.value);
              const conf = confidenceText(f.confidenceTier);
              return (
                <div key={f.findingId} className={styles.side}>
                  <span className={styles.sideSource}>{label}</span>
                  <span className={styles.sideValue}>{value}</span>
                  <span className={styles.sideMeta}>
                    {[conf, modelLabel(f.extractionModel)].filter(Boolean).join(" · ")}
                  </span>
                  <Button
                    disabled={resolve.isPending || other === undefined}
                    aria-label={`Accept ${label}: ${value}`}
                    title={`Accept ${label} and mark the other as rejected`}
                    onClick={() => void accept(f, other)}
                  >
                    {resolve.isPending ? "Resolving…" : "Accept"}
                  </Button>
                </div>
              );
            })}
            <p className={styles.hint}>Pick the source you trust. Resolves to verified.</p>
          </div>
        ) : (
          <>
            <div
              className={[
                styles.value,
                valueText === null ? styles.noValue : "",
                valueText !== null && row.def.kind === "enum" ? styles.valueWords : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {valueText ?? "No value"}
            </div>
            {finding !== undefined && row.state !== "abstained" && (
              <div className={styles.by}>
                <Chip title="Where this value came from">{sourceName(finding)}</Chip>
                {confidence !== null && (
                  <Chip title="The source's confidence in this value">{confidence}</Chip>
                )}
                {modelName !== null && (
                  <Chip title={modelChipTitle(finding.extractionModel)}>{modelName}</Chip>
                )}
                {formatRetrievedShort(finding) !== "" && (
                  <Chip title="When the source was read">{formatRetrievedShort(finding)}</Chip>
                )}
              </div>
            )}
            {shownExcerpt !== null && <p className={styles.excerpt}>{shownExcerpt}</p>}
          </>
        )}

        {row.state === "abstained" && (
          <div className={styles.asked}>
            <p className={styles.askedHead}>
              {excerpt ?? "No source gave a value that held up, so Beacon left it open."}
            </p>
            {row.readings.length > 0 && (
              <ul aria-label="Sources asked">
                {PROVIDER_TRUST.map((p) => {
                  const r = row.readings.find((x) => x.provider === p);
                  return (
                    <li key={p}>
                      <span>{providerLabel(p)}</span>
                      <span className={styles.askedWhy}>
                        {r?.value != null
                          ? `said ${displayFindingValue(row.axis, r.value)}. ${rejectReasonText(r.rejectReason ?? "")}`
                          : "had nothing for this axis"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {said.length > 0 && reading !== undefined && (
          <div className={styles.readings} data-tour="evidence">
            {said.length > 1 && (
              <div className={styles.switch} role="group" aria-label="Source to show">
                {said.map((r) => (
                  <button
                    key={r.provider}
                    type="button"
                    aria-pressed={r.provider === reading.provider}
                    onClick={() => onProvider(r.provider)}
                  >
                    {providerLabel(r.provider)}
                    <span>{displayFindingValue(row.axis, r.value)}</span>
                  </button>
                ))}
              </div>
            )}
            {source !== null && <SourceView documentId={source.documentId} quote={source.quote} />}
            <Checks row={row} reading={reading} />
          </div>
        )}
        {analystEntered && said.length > 0 && (
          <div className={styles.asked}>
            <p className={styles.askedHead}>What each source said</p>
            <ul aria-label="What each source said">
              {said.map((r) => (
                <li key={r.provider}>
                  <span>{providerLabel(r.provider)}</span>
                  <span className={styles.askedWhy}>
                    {displayFindingValue(row.axis, r.value)}
                    {r.grounded === false
                      ? ` (turned down: ${rejectReasonText(r.rejectReason ?? "")})`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {said.length === 0 && source !== null && (
          <SourceView documentId={source.documentId} quote={source.quote} />
        )}

        {prompt !== null && finding !== undefined && (
          <div role="alert" className={styles.prompt}>
            <p>
              You set <strong>{formatAxisValue(prompt.editKey, prompt.mine)}</strong> · the agent
              proposes <strong>{formatAxisValue(prompt.editKey, prompt.theirs)}</strong> (
              {sourceName(finding)}
              {finding.confidenceTier ? `, ${finding.confidenceTier}` : ""})
            </p>
            <div className={styles.promptActions}>
              <Button onClick={keepMine}>Keep mine</Button>
              <Button variant="primary" onClick={takeAgents}>
                Take agent&rsquo;s
              </Button>
            </div>
          </div>
        )}
        {unroutable !== null && (
          <p role="alert" className={styles.problem}>
            {unroutable}
          </p>
        )}
        {errorText !== null && (
          <p role="alert" className={styles.problem}>
            Resolve failed: {errorText}
          </p>
        )}

        <section className={styles.mine} aria-label="Your value" ref={mineRef}>
          {!showEditor ? (
            <button type="button" className={styles.link} onClick={() => setEditing(true)}>
              Set your own value
            </button>
          ) : (
            <>
              <h3 className={styles.mineHead}>
                {rejecting
                  ? `Reject ${valueText ?? "this value"} and use your own`
                  : row.state === "abstained" || row.state === "empty"
                    ? "Needs you: enter a value"
                    : "Set your own value"}
              </h3>
              <ValueEditor
                row={row}
                model={model}
                edits={edits}
                current={getCurrent(editKey)}
                stageLabel={rejecting ? "Reject and use value" : "Use value"}
                onStage={rejecting ? rejectWith : (v) => applyEdit(editKey, v)}
              />
              {(rejecting || editing) && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setRejecting(false);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </section>

        {earlier.length > 0 && (
          <section className={styles.earlier}>
            <button
              type="button"
              className={styles.link}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              title="Other findings for this axis, from other sources or earlier runs"
            >
              {historyOpen ? "Hide" : "Show"} earlier findings ({earlier.length})
            </button>
            {historyOpen && (
              <ul>
                {earlier.map((f) => (
                  <li key={f.findingId}>
                    <span>{sourceName(f)}</span>
                    <span className={styles.earlierValue}>
                      {displayFindingValue(row.axis, f.value)}
                    </span>
                    <span className={styles.earlierMeta}>
                      {f.findingStatus ?? ""} {formatRetrievedShort(f)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {proposed && (
        <div className={styles.acts}>
          <Button onClick={() => setRejecting(true)} title="Reject this value and enter your own">
            Reject <Kbd>R</Kbd>
          </Button>
          <Button variant="primary" onClick={verify} title="Confirm this value as human-checked">
            {valueText !== null && valueText.length <= 14 ? `Verify ${valueText}` : "Verify"}{" "}
            <Kbd>V</Kbd>
          </Button>
        </div>
      )}
    </>
  );
}
