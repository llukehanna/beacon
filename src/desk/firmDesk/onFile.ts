/**
 * What the firm record holds for each axis right now (staged edits first), and the rubric points
 * it earns. Shown beside the sources so "no source had it" never reads as "nothing is known".
 * A staged edit is flagged `pending`, so it is never worded as "on file" before it is committed.
 */
import { criterionFor } from "../../../shared/rubric/catalog";
import { criterionMax } from "../../../shared/rubric/engine";
import type { RubricContext, ScoreResult } from "../../../shared/rubric/types";
import { effectiveAxisValue, formatAxisValue } from "../findingActions";
import { type AxisRow } from "./axisRows";
import { type EditMap, type FirmView, criterionLabelFor } from "./deskModel";

const criterionMaxFor = (
  rubric: RubricContext,
  key: string,
  thesis: string,
): number | undefined => {
  const c = criterionFor(rubric.definition, thesis, key);
  return c === undefined ? undefined : criterionMax(c) * c.weight;
};

export interface OnFile {
  /** The value as the desk words it ("Pass", "12", "Full advisory suite"). */
  text: string;
  /** Points on the axis from the rubric; null for gates and unscored values. */
  band: number | null;
  /** The most points the axis can earn; null when `band` is. */
  bandMax: number | null;
  /** True when the value is only staged in this session: it is not on the firm record until Commit. */
  pending: boolean;
}

/** Keyed by axis (finding vocabulary); an axis with no value on file has no entry. */
export function buildOnFile(
  rubric: RubricContext,
  rows: readonly AxisRow[],
  firm: FirmView,
  edits: EditMap,
  mirror: ScoreResult,
): Record<string, OnFile> {
  const out: Record<string, OnFile> = {};
  for (const row of rows) {
    const key = row.axis;
    const value = effectiveAxisValue(firm, edits, key);
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const label = criterionLabelFor(rubric, key, mirror.model);
    const scored =
      label === undefined ? undefined : mirror.axisScores.find((a) => a.axis === label);
    out[row.axis] = {
      text: formatAxisValue(rubric, key, value),
      band: scored?.known ? scored.score : null,
      bandMax: scored?.known ? (criterionMaxFor(rubric, key, mirror.model) ?? null) : null,
      pending: edits[key] !== undefined && edits[key] !== "",
    };
  }
  return out;
}
