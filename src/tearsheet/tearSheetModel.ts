/**
 * Everything the printable firm tear sheet says, built from the firm, its findings and its
 * decisions. Pure: no React, no data access. It reads the same helpers the Desk does (the rubric
 * mirror, the axis rows, the hard-screen verdict, the decision list), so the sheet cannot say
 * something the Desk does not.
 */
import { type FindingLike } from "@/desk/axisState";
import { displayFindingValue } from "@/desk/findingActions";
import { agentHasRun } from "@/desk/firmDesk/agentRun";
import { type AxisRow, authoritativeFinding, buildAxisRows } from "@/desk/firmDesk/axisRows";
import { firmDecisionState } from "@/desk/firmDesk/decisionState";
import { type FirmView, humanAxisValue, toScoreInput } from "@/desk/firmDesk/deskModel";
import { conflictSides, providerOf } from "@/desk/firmDesk/evidenceModel";
import { type FirmDecision, firmDecisions } from "@/desk/firmDesk/firmDecisions";
import { buildOnFile } from "@/desk/firmDesk/onFile";
import { tierText } from "@/desk/firmDesk/tierMeter";
import { rejectDecisionByFirm } from "@/desk/pipelineRows";
import { type ActiveConfigRule, computeHardScreen } from "@/desk/queue";
import { mirrorScore } from "@/desk/scoreMirror";
import { firmFacts } from "@/pipeline/pipelineModel";
import { MAX_POSSIBLE } from "../../shared/scoreMirror";
import { ENRICH_AXES, providerLabel } from "../../shared/vocab";

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
}

export interface AxisLine {
  axis: string;
  /** The value on file, worded as the Desk words it. */
  value: string;
  /** Points out of 2; null when the axis is unknown. */
  points: number | null;
}

/** Where a value came from: enough to look the sentence up again. */
export interface Citation {
  /** The provider's name, "Analyst" for an analyst's own entry. */
  provider: string;
  /** The sentence the value was read from; null when the entry cites none. */
  quote: string | null;
  /** The extraction model that read it; null when no model was involved. */
  model: string | null;
}

export interface EvidenceItem extends Citation {
  axis: string;
  value: string;
  /** Verified by an analyst, or still only proposed. */
  status: "verified" | "proposed";
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
}

const nonEmpty = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Where a finding's value came from. Only a finding read from a source document has a source
 * sentence, and it is credited to the provider that document belongs to (a corroborated finding
 * carries the lead source's sentence and model, not both providers'). A finding with no document
 * is an analyst's entry: its `sourceExcerpt` holds a note, not a quotation, so it is never cited.
 */
function citationOf(f: FindingLike): Citation {
  const documentProvider = providerOf(f.sourceDocumentId);
  if (nonEmpty(f.sourceDocumentId) === null) {
    return { provider: "Analyst", quote: null, model: null };
  }
  const provider = documentProvider ?? nonEmpty(f.provider);
  return {
    provider: provider === null ? "Source document" : providerLabel(provider),
    quote: nonEmpty(f.sourceQuote),
    model: nonEmpty(f.extractionModel),
  };
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

export function buildTearSheet({ firm, findings, decisions, rules }: TearSheetInput): TearSheet {
  const mirror = mirrorScore(toScoreInput(firm));
  const verdict = computeHardScreen({ ...firm, firmId: firm.firmId ?? "" } as never, rules);
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
    } else if (row.state === "verified" || row.state === "proposed") {
      const f = authoritativeFinding(row);
      if (f !== undefined) {
        evidence.push({
          axis: row.label,
          value: displayFindingValue(row.axis, f.value),
          status: row.state,
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
    axes: mirror.axisScores.map((a) => ({
      axis: a.axis,
      value: humanAxisValue(a.axis, firm),
      points: a.known ? a.score : null,
    })),
    evidence,
    conflicts,
    abstentions,
    decisions: firmDecisions(decisions),
  };
}
