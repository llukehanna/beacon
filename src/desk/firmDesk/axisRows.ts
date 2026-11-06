/**
 * The rows of the axis by source grid. Each row pairs what every provider said about one rubric
 * axis (from the observations) with what Beacon decided (from the stored findings). Pure: no
 * React, no data access.
 */
import type { FirmObservations, ProviderObservation } from "../../../shared/summaries";
import { type AxisDef, PROVIDER_TRUST } from "../../../shared/vocab";
import { type FindingLike, classifyAxis, pickAuthoritative } from "../axisState";
import { FINDING_AXIS_TO_KEY, displayFindingValue } from "../findingActions";
import { displayAxis } from "./deskModel";

export type RowState =
  "conflict" | "proposed" | "verified" | "abstained" | "rejected" | "signal" | "empty";

export interface CellView {
  value: string | null;
  confidence: "high" | "low" | null;
}

/** A reading the grounding checks turned down: what the provider said and why it was not kept. */
export interface Rejection {
  provider: string;
  value: string;
  reason: string;
}

export interface AxisRow {
  /** The finding-vocabulary name, e.g. `fee_generating_count`. */
  axis: string;
  def: AxisDef;
  label: string;
  /** "×1" for a scored axis (each adds 0 to 2 of the 18 points), "gate" for a pass/fail gate. */
  weight: string;
  state: RowState;
  /** Keyed by provider, every provider present; `value: null` where it had nothing kept. */
  cells: Record<string, CellView>;
  rejections: Rejection[];
  /** The raw reading per provider; empty while observations load. */
  readings: ProviderObservation[];
  /** Stored findings for this axis, superseded ones left out. */
  findings: FindingLike[];
}

const isStatus = (f: FindingLike, status: string): boolean =>
  (f.findingStatus ?? "").toLowerCase() === status;

const isGrouped = (f: FindingLike): boolean =>
  f.conflictGroupId !== undefined && f.conflictGroupId !== null && f.conflictGroupId !== "";

const matchesAxis = (def: AxisDef, f: FindingLike): boolean =>
  FINDING_AXIS_TO_KEY[(f.axis ?? "").trim().toLowerCase()] === def.actionParam;

/** The two (or more) sides of a conflict that is still open: grouped findings, one still proposed. */
export function openConflictFindings(row: Pick<AxisRow, "findings">): FindingLike[] {
  const groups = new Map<string, FindingLike[]>();
  for (const f of row.findings) {
    if (isGrouped(f)) {
      const id = f.conflictGroupId as string;
      groups.set(id, [...(groups.get(id) ?? []), f]);
    }
  }
  for (const members of groups.values()) {
    if (members.some((m) => isStatus(m, "proposed"))) {
      return members;
    }
  }
  return [];
}

/**
 * What Beacon decided for an axis. An open conflict outranks everything; otherwise the
 * authoritative finding (human-verified first, then the latest) decides, the same rule the
 * queue's counts use. Findings turned down by an analyst do not speak for the axis unless
 * nothing else is left.
 */
function stateOf(findings: readonly FindingLike[]): RowState {
  if (findings.length === 0) {
    return "empty";
  }
  if (openConflictFindings({ findings: [...findings] }).length > 0) {
    return "conflict";
  }
  const live = findings.filter((f) => !isStatus(f, "rejected"));
  return live.length === 0 ? "rejected" : classifyAxis(pickAuthoritative(live));
}

/** The finding that speaks for the axis; none while a conflict is open or when nothing was found. */
export function authoritativeFinding(row: AxisRow): FindingLike | undefined {
  if (row.state === "conflict" || row.state === "empty" || row.state === "rejected") {
    return undefined;
  }
  const live = row.findings.filter((f) => !isStatus(f, "rejected"));
  return live.length === 0 ? undefined : pickAuthoritative(live);
}

const emptyCell = (): CellView => ({ value: null, confidence: null });

/**
 * One row per axis, in the order given (rubric order). `obs` is undefined while the observations
 * load: every cell is then empty and the status still comes from the findings.
 */
export function buildAxisRows(
  axes: readonly AxisDef[],
  obs: FirmObservations | undefined,
  findings: readonly FindingLike[],
): AxisRow[] {
  const visible = findings.filter((f) => !isStatus(f, "superseded"));
  return axes.map((def): AxisRow => {
    const readings = obs?.axes.find((a) => a.axis === def.axis)?.providers ?? [];
    const cells: Record<string, CellView> = {};
    const rejections: Rejection[] = [];
    for (const provider of PROVIDER_TRUST) {
      const reading = readings.find((r) => r.provider === provider);
      if (reading?.value != null && reading.grounded === true) {
        cells[provider] = {
          value: displayFindingValue(def.axis, reading.value),
          confidence: reading.confidence,
        };
        continue;
      }
      cells[provider] = emptyCell();
      if (reading?.value != null && reading.grounded === false) {
        rejections.push({
          provider,
          value: displayFindingValue(def.axis, reading.value),
          reason: reading.rejectReason ?? "rejected",
        });
      }
    }
    const own = visible.filter((f) => matchesAxis(def, f));
    return {
      axis: def.axis,
      def,
      label: displayAxis(def.axis),
      weight: def.kind === "gate" ? "gate" : "×1",
      state: stateOf(own),
      cells,
      rejections,
      readings: [...readings],
      findings: own,
    };
  });
}

export interface RowCounts {
  conflicts: number;
  proposed: number;
  abstained: number;
  verified: number;
}

/** The findings summary above the grid. Conflicts count open ones only, as the queue does. */
export function summarizeRows(rows: readonly AxisRow[]): RowCounts {
  const counts: RowCounts = { conflicts: 0, proposed: 0, abstained: 0, verified: 0 };
  for (const row of rows) {
    if (row.state === "conflict") {
      counts.conflicts++;
    } else if (row.state === "proposed") {
      counts.proposed++;
    } else if (row.state === "abstained") {
      counts.abstained++;
    } else if (row.state === "verified") {
      counts.verified++;
    }
  }
  return counts;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "1 conflict · 3 proposed · 2 abstained · 1 verified": the open work on this firm. */
export function summaryText(c: RowCounts): string {
  return `${plural(c.conflicts, "conflict", "conflicts")} · ${c.proposed} proposed · ${c.abstained} abstained · ${c.verified} verified`;
}
