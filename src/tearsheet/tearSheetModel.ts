/**
 * Everything the printable firm tear sheet says, built from the firm, its findings and its
 * decisions. Pure: no React, no data access. It reads the same helpers the Desk does (the rubric
 * mirror, the axis rows, the hard-screen verdict, the decision list), so the sheet cannot say
 * something the Desk does not.
 */
import { type FindingLike } from "@/desk/axisState";
import { agentHasRun } from "@/desk/firmDesk/agentRun";
import { firmDecisionState } from "@/desk/firmDesk/decisionState";
import { type FirmDecision, firmDecisions } from "@/desk/firmDesk/firmDecisions";
import { buildOnFile } from "@/desk/firmDesk/onFile";
import { tierText } from "@/desk/firmDesk/tierMeter";
import { rejectDecisionByFirm } from "@/desk/pipelineRows";
import { type ActiveConfigRule, computeHardScreen } from "@/desk/queue";
import { mirrorScore } from "@/desk/scoreMirror";
import { firmFacts } from "@/pipeline/pipelineModel";
import { type AxisRow, authoritativeFinding, buildAxisRows } from "../../shared/axisRows";
import { type Citation, citationOf, nonEmpty } from "../../shared/citation";
import {
  type FirmView,
  humanAxisValue,
  mirrorLabelForEditKey,
  toScoreInput,
} from "../../shared/deskModel";
import { conflictSides } from "../../shared/evidenceModel";
import { coerceFindingValue, displayFindingValue } from "../../shared/findingActions";
import {
  SYNTHETIC_LABEL,
  type SignalLike,
  axisMovedText,
  isApplied,
  kindLabel,
} from "../../shared/marketSignals";
import { MAX_POSSIBLE } from "../../shared/scoreMirror";
import { ENRICH_AXES, MARKET_SIGNAL } from "../../shared/vocab";

/** A ReviewDecision as the sheet reads it. */
export interface DecisionInput {
  decisionId?: string;
  firmId?: string | null;
  decisionType?: string | null;
  rejectionRationale?: string | null;
  scoreAtDecision?: number | null;
  tierAtDecision?: string | null;
  decidedAt?: unknown;
}

export interface TearSheetInput {
  firm: FirmView;
  findings: readonly FindingLike[];
  decisions: readonly DecisionInput[];
  /** The approved screening rules, as the Desk ranks on them. */
  rules: readonly ActiveConfigRule[];
  /** The firm's market signals; only the applied ones are reported. */
  signals?: readonly SignalLike[];
}

/** An applied market signal as the sheet lists it. Always synthetic. */
export interface SignalLine {
  id: string;
  headline: string;
  /** "Departure", "Senior hire", ... */
  kind: string;
  /** The day it took effect (yyyy-mm-dd), on the reader's calendar. */
  date: string;
  /** What it moved: "Fee-earning heads → 3". */
  moved: string;
  /** Always "Synthetic market signal". */
  label: string;
}

export interface AxisLine {
  axis: string;
  /** The value on file, worded as the Desk words it; with nothing on file, the agent's open proposal. */
  value: string;
  /** Points out of 2; null when nothing is on file for the axis. */
  points: number | null;
  /**
   * Where the value comes from: the firm record, an agent proposal no analyst has verified yet,
   * sources that disagree, or nothing at all. Only an on-file value earns points.
   */
  status: "on_file" | "proposed" | "conflict" | "unknown";
}

export type { Citation };

export interface EvidenceItem extends Citation {
  axis: string;
  value: string;
  /** Verified by an analyst, or still only proposed. */
  status: "verified" | "proposed" | "signal";
  /** Written by a synthetic market signal: news, not an analyst's check. */
  synthetic: boolean;
}

export interface ConflictSide extends Citation {
  value: string;
}

export interface ConflictItem {
  axis: string;
  sides: ConflictSide[];
}

export interface AbstentionItem {
  axis: string;
  /** What the firm record holds for the axis despite the abstention, when it holds anything. */
  onFile: string | null;
}

export interface TearSheet {
  name: string;
  /** The lifecycle stage ("Screening", "Passed"). */
  stage: string;
  /** Whether the agent has run on the firm; when not, an empty evidence list means nothing is known yet. */
  researched: boolean;
  /** Whether the sheet cites at least one source sentence. */
  hasQuotes: boolean;
  /** The profile as label and value pairs, leaving out what is not on file. */
  facts: Array<{ label: string; value: string }>;
  /** The firm's live score. */
  score: {
    total: number;
    max: number;
    tier: string;
    /** "Tier B", "Below C" or "Rejected", as the Desk words it. */
    tierText: string;
    model: "CF" | "CS";
    /** Why a screened firm is out; null otherwise. */
    screenedBecause: string | null;
  };
  /** The score a passed firm had when it was passed; null when the firm is not passed or none was recorded. */
  atDecision: { total: number; tier: string } | null;
  axes: AxisLine[];
  evidence: EvidenceItem[];
  conflicts: ConflictItem[];
  abstentions: AbstentionItem[];
  decisions: FirmDecision[];
  /** Applied market signals, newest first. */
  signals: SignalLine[];
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** A day as the reader's own calendar has it (yyyy-mm-dd), not the UTC day. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const decidedAtMs = (d: DecisionInput): number => {
  const raw = d.decidedAt;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** The applied signals, newest first, worded for the sheet. */
export function signalLines(signals: readonly SignalLike[]): SignalLine[] {
  const at = (s: SignalLike): number => {
    const t = new Date(s.effectiveDate as string | number).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return signals
    .filter(isApplied)
    .sort((a, b) => at(b) - at(a) || (b.signalId ?? "").localeCompare(a.signalId ?? ""))
    .map((s) => ({
      id: s.signalId ?? "",
      headline: nonEmpty(s.headline) ?? "No headline",
      kind: kindLabel(s.kind),
      date: at(s) === 0 ? "" : localDay(at(s)),
      moved: axisMovedText(s),
      label: SYNTHETIC_LABEL,
    }));
}

/**
 * One row of the score table. A value on file is scored. With nothing on file the Desk's grid has
 * the answer: an open proposal is shown, marked unverified and not scored, and sources that disagree
 * say so. "Unknown" is left for an axis nobody has a value for.
 */
function axisLine(
  a: { axis: string; score: number; known: boolean },
  firm: FirmView,
  rows: readonly AxisRow[],
  model: "CF" | "CS",
): AxisLine {
  if (a.known) {
    return {
      axis: a.axis,
      value: humanAxisValue(a.axis, firm),
      points: a.score,
      status: "on_file",
    };
  }
  const row = rows.find((r) => mirrorLabelForEditKey(r.def.actionParam, model) === a.axis);
  if (row?.state === "proposed") {
    const proposal = coerceFindingValue(row.def.actionParam, authoritativeFinding(row)?.value);
    if (proposal !== undefined) {
      const withProposal: FirmView = { ...firm, [row.def.firmField]: proposal };
      return {
        axis: a.axis,
        value: humanAxisValue(a.axis, withProposal),
        points: null,
        status: "proposed",
      };
    }
  }
  if (row?.state === "conflict") {
    return { axis: a.axis, value: "Sources disagree", points: null, status: "conflict" };
  }
  return { axis: a.axis, value: humanAxisValue(a.axis, firm), points: null, status: "unknown" };
}

export function buildTearSheet({
  firm,
  findings,
  decisions,
  rules,
  signals = [],
}: TearSheetInput): TearSheet {
  const mirror = mirrorScore(toScoreInput(firm));
  const verdict = computeHardScreen({ ...firm, firmId: firm.firmId ?? "" }, rules);
  const hard = mirror.hardRejected || verdict.hardScreened;
  // The stage is the firm's lifecycle stage, as the Desk header chip words it. A screen is shown
  // beside it (score.screenedBecause), never as a stage: a rule-screened firm nobody has passed
  // is not "Passed".
  const { stageLabel: stage, terminalKind } = firmDecisionState(firm);
  const passed = terminalKind === "passed";

  // The Desk header words a hard-screened firm's reason from the mirror first, then the rule.
  const screenedBecause = hard
    ? mirror.hardRejected
      ? mirror.rejectReason
      : (verdict.reason ?? "screened")
    : null;

  // Newest reject decision, as the Pipeline reads the score a passed firm was passed at.
  const newestFirst = [...decisions].sort((a, b) => decidedAtMs(b) - decidedAtMs(a));
  const rejected = rejectDecisionByFirm(newestFirst).get(firm.firmId ?? "");
  const atDecision =
    passed &&
    rejected !== undefined &&
    typeof rejected.scoreAtDecision === "number" &&
    nonEmpty(rejected.tierAtDecision) !== null
      ? { total: rejected.scoreAtDecision, tier: rejected.tierAtDecision as string }
      : null;

  const rows: AxisRow[] = buildAxisRows(
    ENRICH_AXES.filter((a) => a.models.includes(mirror.model)),
    undefined,
    findings,
  );
  const onFile = buildOnFile(rows, firm, {}, mirror);

  const evidence: EvidenceItem[] = [];
  const conflicts: ConflictItem[] = [];
  const abstentions: AbstentionItem[] = [];
  for (const row of rows) {
    if (row.state === "conflict") {
      conflicts.push({
        axis: row.label,
        sides: conflictSides(row).map((f) => ({
          value: displayFindingValue(row.axis, f.value),
          ...citationOf(f),
        })),
      });
    } else if (row.state === "abstained") {
      abstentions.push({ axis: row.label, onFile: onFile[row.axis]?.text ?? null });
    } else if (row.state === "verified" || row.state === "proposed" || row.state === "signal") {
      const f = authoritativeFinding(row);
      if (f !== undefined) {
        evidence.push({
          axis: row.label,
          value: displayFindingValue(row.axis, f.value),
          status: row.state,
          synthetic: (f.provider ?? "").trim().toLowerCase() === MARKET_SIGNAL,
          ...citationOf(f),
        });
      }
    }
  }

  return {
    name: firm.firmName ?? firm.firmId ?? "",
    stage,
    researched: agentHasRun(findings),
    hasQuotes: [...evidence, ...conflicts.flatMap((c) => c.sides)].some((c) => c.quote !== null),
    facts: [
      ...(nonEmpty(firm.firmType) === null
        ? []
        : [{ label: "Firm type", value: firm.firmType as string }]),
      ...(nonEmpty(firm.sector) === null
        ? []
        : [{ label: "Sector", value: firm.sector as string }]),
      ...(nonEmpty(firm.hqCountry) === null
        ? []
        : [{ label: "HQ", value: firm.hqCountry as string }]),
      ...firmFacts(firm),
    ],
    score: {
      total: mirror.weightedTotal,
      max: MAX_POSSIBLE,
      tier: mirror.tier,
      tierText: tierText(mirror.tier, hard),
      model: mirror.model,
      screenedBecause,
    },
    atDecision,
    axes: mirror.axisScores.map((a) => axisLine(a, firm, rows, mirror.model)),
    evidence,
    conflicts,
    abstentions,
    decisions: firmDecisions(decisions),
    signals: signalLines(signals),
  };
}
