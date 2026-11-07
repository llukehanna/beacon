/** What the decision bar needs to know about a firm: where it stands and what is left to confirm. */
import {
  PASSED,
  isQualifiedOrLater,
  nextLifecycle,
  normalizeLifecycle,
} from "../../../shared/vocab";
import { type MirrorResult } from "../scoreMirror";
import { type EditMap, type FirmView } from "./deskModel";
import { HARD_GATES } from "./hardGateConfig";
import { type Projection } from "./projection";

export interface FirmDecisionState {
  /** The stage as the bar words it ("Passed" wins over any other stage). */
  stageLabel: string;
  /** Passed and Closed firms take no further decision. */
  terminalKind: "closed" | "passed" | null;
  /** Past the Qualify decision: the move is Advance, not Qualify. */
  qualified: boolean;
  /** Where Advance would move a qualified firm; null at the last stage. */
  nextState: string | null;
}

export function firmDecisionState(
  firm: Pick<FirmView, "lifecycleState" | "currentStage">,
): FirmDecisionState {
  // The stage comes from lifecycleState first, falling back to currentStage; normalizeLifecycle
  // maps legacy names onto the funnel. Terminal means the firm was Passed (in either field) or
  // has Closed.
  const stage = normalizeLifecycle(firm.lifecycleState ?? firm.currentStage);
  const passed = [firm.lifecycleState, firm.currentStage].some(
    (raw) => normalizeLifecycle(raw) === PASSED,
  );
  const terminalKind = passed ? "passed" : stage === "Closed" ? "closed" : null;
  // Advance moves a qualified firm one stage down the deal funnel. Before Qualified the move is
  // the Qualify decision.
  const qualified = !passed && isQualifiedOrLater(stage);
  return {
    stageLabel: passed ? PASSED : stage,
    terminalKind,
    qualified,
    nextState: qualified ? nextLifecycle(stage) : null,
  };
}

export interface ConfirmItem {
  id: "axes" | "gates" | "screen";
  label: string;
  detail: string;
  ok: boolean;
}

/**
 * The three things to confirm before advancing a firm: every scored axis has a value on file,
 * every gate is answered, the hard screen is cleared. `projection` is the score the open proposals
 * would give; when the values on file clear the screen but the proposals would not, the screen
 * line says both, so it never contradicts the score box.
 */
export function confirmItems(
  firm: FirmView,
  mirror: MirrorResult,
  edits: EditMap,
  projection: Pick<Projection, "hardRejected" | "rejectReason"> | null = null,
): ConfirmItem[] {
  const knownAxes = mirror.axisScores.filter((a) => a.known).length;
  const totalAxes = mirror.axisScores.length;
  const gatesSet = HARD_GATES.filter((g) => {
    const staged = edits[g.editKey];
    const stored = firm[g.readKey];
    return typeof staged === "boolean" || stored === true || stored === false;
  }).length;
  const wouldReject = !mirror.hardRejected && projection?.hardRejected === true;
  const screen = mirror.hardRejected
    ? { label: "Hard screen (rejected)", detail: mirror.rejectReason }
    : wouldReject
      ? {
          label: "Cleared the hard screen on the values on file",
          detail: `would be hard-rejected if proposals are verified: ${projection.rejectReason}`,
        }
      : { label: "Cleared the hard screen", detail: "no rejection triggers" };
  return [
    {
      id: "axes",
      label: "Every scored axis has a value on file",
      detail:
        totalAxes === 0
          ? "not scored: the firm is hard-rejected"
          : `${knownAxes} of ${totalAxes} scored axes on file`,
      ok: knownAxes === totalAxes,
    },
    {
      id: "gates",
      label: "Hard gates recorded",
      detail: `${gatesSet}/${HARD_GATES.length} gates answered`,
      ok: gatesSet === HARD_GATES.length,
    },
    { id: "screen", ...screen, ok: !mirror.hardRejected },
  ];
}
