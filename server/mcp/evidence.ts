/**
 * What the Desk shows for one firm, as plain data: each rubric axis with its value and the citation
 * behind it, and the two sides of an open conflict. Pure: no database, no persona.
 *
 * This is the Desk's own code, not a copy of it. The axis rows, the choice of the finding that
 * speaks for an axis (human-verified first, else the latest, a newer market signal over an older
 * check), the value wording and the citation all come from the modules the Desk and the tear sheet
 * render with, so an assistant is never told something the analyst cannot see on screen.
 */
import { authoritativeFinding, buildAxisRows } from "../../shared/axisRows.js";
import { type Citation, citationOf } from "../../shared/citation.js";
import { conflictSides } from "../../shared/evidenceModel.js";
import { displayFindingValue } from "../../shared/findingActions.js";
import type { RubricContext } from "../../shared/rubric/types.js";
import type { ObjectOf } from "../../shared/schema.js";
import { scoreFirm } from "../../shared/scoring.js";

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
  score: { total: number; max: number; tier: string; model: string };
  axes: AxisEvidence[];
}

/** The firm's evidence for `findings` (all of the firm's, whatever their status). */
export function firmEvidence(
  rubric: RubricContext,
  firm: ObjectOf<"Firm">,
  findings: readonly ObjectOf<"ResearchFinding">[],
): FirmEvidence {
  const live = scoreFirm(rubric.definition, firm);
  const rows = buildAxisRows(rubric, live.model, undefined, findings);
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
          value: displayFindingValue(rubric, row.axis, f.value, { units: false }),
          ...citationOf(f),
        })),
      };
    }
    const f = authoritativeFinding(row);
    if (f === undefined || row.state === "abstained") {
      return base;
    }
    return {
      ...base,
      value: displayFindingValue(rubric, row.axis, f.value, { units: false }),
      ...citationOf(f),
    };
  });
  return {
    firmId: firm.$primaryKey,
    firmName: firm.firmName ?? firm.$primaryKey,
    score: {
      total: live.weightedTotal,
      max: live.maxPossible,
      tier: live.tier,
      model: live.model,
    },
    axes,
  };
}
