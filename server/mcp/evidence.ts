/**
 * What the Desk shows for one firm, as plain data: each rubric axis with its value and the citation
 * behind it, and the two sides of an open conflict. Pure: no database, no persona.
 *
 * This is the Desk's own code, not a copy of it. The axis rows, the choice of the finding that
 * speaks for an axis (human-verified first, else the latest, a newer market signal over an older
 * check), the value wording and the citation all come from the modules the Desk and the tear sheet
 * render with, so an assistant is never told something the analyst cannot see on screen.
 */
import type { ObjectOf } from "../../shared/schema.js";
import { MAX_POSSIBLE, mirrorScore } from "../../shared/scoreMirror.js";
import { ENRICH_AXES } from "../../shared/vocab.js";
import { type FindingLike } from "../../src/desk/axisState.js";
import { displayFindingValue } from "../../src/desk/findingActions.js";
import { authoritativeFinding, buildAxisRows } from "../../src/desk/firmDesk/axisRows.js";
import { type Citation, citationOf } from "../../src/desk/firmDesk/citation.js";
import { type FirmView, toScoreInput } from "../../src/desk/firmDesk/deskModel.js";
import { conflictSides } from "../../src/desk/firmDesk/evidenceModel.js";

/** One side of an open conflict: a value one source gave, and where it came from. */
export interface ConflictSideEvidence extends Citation {
  value: string;
}

/** The status of an axis, as the Desk's grid words it. */
export type AxisStatus =
  "verified" | "proposed" | "signal" | "abstained" | "conflict" | "rejected" | "empty";

export interface AxisEvidence {
  /** The rubric axis in the findings vocabulary, e.g. `fee_generating_count`. */
  axis: string;
  /** The axis as the Desk labels it. */
  label: string;
  status: AxisStatus;
  /** The value the Desk shows; null when there is none to show (a conflict, an abstention, nothing found). */
  value: string | null;
  /** The provider the value is credited to ("Analyst" for a hand entry); null when there is no value. */
  provider: string | null;
  /** The sentence the value was read from; null when none is cited. */
  quote: string | null;
  /** The extraction model that read it; null when no model was involved. */
  model: string | null;
  /** For a conflict: the two most trusted sides. Empty otherwise. */
  sides: ConflictSideEvidence[];
}

export interface FirmEvidence {
  firmId: string;
  firmName: string;
  /** The live rubric score and tier the Desk shows for the firm. */
  score: { total: number; max: number; tier: string; model: "CF" | "CS" };
  axes: AxisEvidence[];
}

/** The firm's evidence for `findings` (all of the firm's, whatever their status). */
export function firmEvidence(
  firm: ObjectOf<"Firm">,
  findings: readonly ObjectOf<"ResearchFinding">[],
): FirmEvidence {
  const view = firm as unknown as FirmView;
  const mirror = mirrorScore(toScoreInput(view));
  const rows = buildAxisRows(
    ENRICH_AXES.filter((a) => a.models.includes(mirror.model)),
    undefined,
    findings as unknown as FindingLike[],
  );
  const axes = rows.map((row): AxisEvidence => {
    const base = {
      axis: row.axis,
      label: row.label,
      status: row.state,
      value: null,
      provider: null,
      quote: null,
      model: null,
      sides: [],
    } satisfies AxisEvidence;
    if (row.state === "conflict") {
      return {
        ...base,
        sides: conflictSides(row).map((f) => ({
          value: displayFindingValue(row.axis, f.value),
          ...citationOf(f),
        })),
      };
    }
    const f = authoritativeFinding(row);
    if (f === undefined || row.state === "abstained") {
      return base;
    }
    return { ...base, value: displayFindingValue(row.axis, f.value), ...citationOf(f) };
  });
  return {
    firmId: firm.$primaryKey,
    firmName: firm.firmName ?? firm.$primaryKey,
    score: {
      total: mirror.weightedTotal,
      max: MAX_POSSIBLE,
      tier: mirror.tier,
      model: mirror.model,
    },
    axes,
  };
}
