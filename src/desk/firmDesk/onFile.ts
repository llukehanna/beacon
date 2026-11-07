/**
 * What the firm record holds for each axis right now (staged edits first), and the rubric points
 * it earns. Shown beside the sources so "no source had it" never reads as "nothing is known".
 * A staged edit is flagged `pending`, so it is never worded as "on file" before it is committed.
 */
import { effectiveAxisValue, formatAxisValue } from "../findingActions";
import { type MirrorResult } from "../scoreMirror";
import { type AxisRow } from "./axisRows";
import { type EditMap, type FirmView, mirrorLabelForEditKey } from "./deskModel";

export interface OnFile {
  /** The value as the desk words it ("Pass", "12", "Full advisory suite"). */
  text: string;
  /** Points on the axis (0 to 2) from the rubric mirror; null for gates and unscored values. */
  band: number | null;
  /** True when the value is only staged in this session: it is not on the firm record until Commit. */
  pending: boolean;
}

/** Keyed by axis (finding vocabulary); an axis with no value on file has no entry. */
export function buildOnFile(
  rows: readonly AxisRow[],
  firm: FirmView,
  edits: EditMap,
  mirror: MirrorResult,
): Record<string, OnFile> {
  const out: Record<string, OnFile> = {};
  for (const row of rows) {
    const key = row.def.actionParam;
    const value = effectiveAxisValue(firm, edits, key);
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const label = mirrorLabelForEditKey(key, mirror.model);
    const scored =
      label === undefined ? undefined : mirror.axisScores.find((a) => a.axis === label);
    out[row.axis] = {
      text: formatAxisValue(key, value),
      band: scored?.known ? scored.score : null,
      pending: edits[key] !== undefined && edits[key] !== "",
    };
  }
  return out;
}
