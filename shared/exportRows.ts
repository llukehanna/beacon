/**
 * Target lists as plain rows, for the Excel workbook and the CRM files. Pure: no React, no data
 * access, no file API. A page hands over the firms it shows and the findings behind them; what
 * comes back is the same table for every format, so the workbook, the CSVs and the score on screen
 * cannot drift apart.
 *
 * An axis with nothing behind it (no source had a value, or the source abstained) exports as an
 * empty value and a citation made of nulls. The files print that as "no source", never as a blank
 * that could be read as a value, and never as the word "undefined".
 */
import { type FindingLike as AxisFinding, classifyAxis, pickAuthoritative } from "./axisState.js";
import { bucketOf } from "./pipelineBuckets.js";
import type { ObjectOf } from "./schema.js";
import { MAX_POSSIBLE, mirrorScore } from "./scoreMirror.js";
import { parseAxisValue, scoreInputFromFirm } from "./scoring.js";
import { axisLabel } from "./trustMetrics.js";
import { type AxisDef, ENRICH_AXES, providerLabel } from "./vocab.js";

type Nullable<T> = { [K in keyof T]?: T[K] | null };

/** The Firm properties an export reads; every one may be missing. */
export type FirmLike = Nullable<
  Pick<
    ObjectOf<"Firm">,
    | "firmId"
    | "firmName"
    | "firmType"
    | "hqCountry"
    | "sector"
    | "employees"
    | "revenueBand"
    | "ownership"
    | "successionRisk"
    | "coverageModel"
    | "lifecycleState"
    | "currentStage"
    | "disposition"
    // The axis values and score inputs live on the firm as well.
    | "servicesFit"
    | "mdPedigree"
    | "balanceSheetPrincipal"
    | "geoScore"
    | "dealSizeMUsd"
    | "dealsPerMdL3y"
    | "firmAge"
    | "feeGeneratingCount"
    | "geographicFootprint"
    | "advisoryConflict"
    | "hasSTOrBalanceSheet"
    | "webActivity"
    | "solvent"
  >
> & {
  /** The score and tier the page shows for this firm, when that differs from the live score (a passed firm). */
  score?: number | null;
  tier?: string | null;
};

/** The ResearchFinding properties an export reads; every one may be missing. */
export type FindingLike = Nullable<
  Pick<
    ObjectOf<"ResearchFinding">,
    | "findingId"
    | "firmId"
    | "axis"
    | "value"
    | "provider"
    | "sourceExcerpt"
    | "sourceDocumentId"
    | "sourceQuote"
    | "extractionModel"
    | "confidenceTier"
    | "findingStatus"
    | "verifiedByHuman"
    | "conflictGroupId"
    | "retrievedAt"
    | "verifiedAt"
  >
>;

export interface ExportRow {
  firmId: string;
  firmName: string;
  tier: string;
  score: number;
  [axis: string]: string | number | null;
}

/** Where one axis value came from. All null when nothing is on file for the axis. */
export interface Citation {
  axis: string;
  provider: string | null;
  quote: string | null;
  model: string | null;
}

/** What an empty axis or citation cell reads in a file. */
export const NO_SOURCE = "no source";

/** Profile columns after the score, in file order. Keys are Firm properties. */
export const PROFILE_COLUMNS = [
  { key: "stage", header: "Stage" },
  { key: "firmType", header: "Firm type" },
  { key: "hqCountry", header: "HQ country" },
  { key: "sector", header: "Sector" },
  { key: "employees", header: "Employees" },
  { key: "revenueBand", header: "Revenue band" },
  { key: "ownership", header: "Ownership" },
  { key: "successionRisk", header: "Succession risk" },
  { key: "coverageModel", header: "Coverage" },
] as const;

const PROFILE_TEXT_KEYS = [
  "firmType",
  "hqCountry",
  "sector",
  "revenueBand",
  "ownership",
  "successionRisk",
  "coverageModel",
] as const;

function text(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

function axisValue(def: AxisDef, raw: string | number | boolean | null | undefined) {
  if (raw === null || raw === undefined) {
    return null;
  }
  const v = typeof raw === "string" ? parseAxisValue(def, raw) : raw;
  if (v === null) {
    return typeof raw === "string" ? text(raw) : null;
  }
  if (typeof v === "boolean") {
    return v ? "Yes" : "No";
  }
  return v;
}

// The axisState rules take undefined, not null, for a missing property.
function forAxisState(f: FindingLike): AxisFinding {
  const opt = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
  return {
    findingId: f.findingId ?? "",
    axis: opt(f.axis),
    value: opt(f.value),
    provider: opt(f.provider),
    sourceExcerpt: opt(f.sourceExcerpt),
    sourceDocumentId: f.sourceDocumentId,
    sourceQuote: f.sourceQuote,
    extractionModel: f.extractionModel,
    confidenceTier: opt(f.confidenceTier),
    findingStatus: opt(f.findingStatus),
    verifiedByHuman: opt(f.verifiedByHuman),
    conflictGroupId: opt(f.conflictGroupId),
    retrievedAt: f.retrievedAt,
    verifiedAt: f.verifiedAt,
  };
}

function findingsByFirmAxis(findings: readonly FindingLike[]): Map<string, AxisFinding[]> {
  const out = new Map<string, AxisFinding[]>();
  for (const f of findings) {
    const firmId = text(f.firmId);
    const axis = text(f.axis);
    // Superseded findings are history. A finding in a conflict group is a disagreement, not a value.
    if (
      firmId === null ||
      axis === null ||
      (f.findingStatus ?? "").toLowerCase() === "superseded"
    ) {
      continue;
    }
    if (text(f.conflictGroupId) !== null) {
      continue;
    }
    const key = `${firmId}\u0000${axis.toLowerCase()}`;
    out.set(key, [...(out.get(key) ?? []), forAxisState(f)]);
  }
  return out;
}

const EMPTY_CITATION = (axis: string): Citation => ({
  axis,
  provider: null,
  quote: null,
  model: null,
});

/**
 * One row per firm and, beside it, one citation per axis. The value on an axis is what a source
 * found (an abstained finding found nothing), else what is already on the firm, else null.
 */
export function exportRows(
  firms: readonly FirmLike[],
  findings: readonly FindingLike[],
): { rows: ExportRow[]; citations: Citation[][] } {
  const byFirmAxis = findingsByFirmAxis(findings);
  const rows: ExportRow[] = [];
  const citations: Citation[][] = [];

  for (const firm of firms) {
    const firmId = text(firm.firmId) ?? "";
    const mirror = mirrorScore(scoreInputFromFirm(firm));
    const row: ExportRow = {
      firmId,
      firmName: text(firm.firmName) ?? firmId,
      tier: text(firm.tier) ?? mirror.tier,
      score: typeof firm.score === "number" ? firm.score : mirror.weightedTotal,
      stage: bucketOf(firm, mirror),
    };
    for (const key of PROFILE_TEXT_KEYS) {
      row[key] = text(firm[key]);
    }
    row.employees = typeof firm.employees === "number" ? firm.employees : null;

    const cites: Citation[] = [];
    for (const def of ENRICH_AXES) {
      const own = axisValue(def, firm[def.firmField as keyof FirmLike]);
      const found = byFirmAxis.get(`${firmId}\u0000${def.axis}`);
      const auth = found === undefined ? undefined : pickAuthoritative(found);
      if (auth === undefined || classifyAxis(auth) === "abstained") {
        row[def.axis] = own;
        cites.push(EMPTY_CITATION(def.axis));
        continue;
      }
      const fromFinding = axisValue(def, auth.value);
      if (fromFinding === null) {
        // The finding has no usable value: use the firm's own value, uncited.
        row[def.axis] = own;
        cites.push(EMPTY_CITATION(def.axis));
        continue;
      }
      row[def.axis] = fromFinding;
      const provider = text(auth.provider);
      cites.push({
        axis: def.axis,
        provider: provider === null ? null : providerLabel(provider),
        // Only a finding read from a source document has a source sentence. An analyst's entry
        // keeps a note in sourceExcerpt, which is not a quotation, so it is never cited.
        quote: text(auth.sourceDocumentId) === null ? null : text(auth.sourceQuote),
        model: text(auth.extractionModel),
      });
    }
    rows.push(row);
    citations.push(cites);
  }
  return { rows, citations };
}

// ─── Cells ───────────────────────────────────────────────────────────────

export type Cell = string | number | null;

/**
 * A spreadsheet runs a CSV cell that starts with = + - @ (or a tab or carriage return) as a
 * formula. A leading apostrophe makes it text (the OWASP guidance); it stays visible in the cell.
 * The workbook does not use this: it writes every text cell as a string cell, which Excel never
 * evaluates, so names keep their literal text.
 */
export function neutralise(cell: Cell): Cell {
  return typeof cell === "string" && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/** RFC 4180: CRLF between records, fields quoted when they hold a comma, quote or line break. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const field = (cell: Cell): string => {
    const s = cell === null ? "" : String(neutralise(cell));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

export interface Table {
  headers: string[];
  rows: Cell[][];
}

const AXIS_KEYS = ENRICH_AXES.map((a) => a.axis);

// The yes/no gates have no label in the trust tables, which print a title-cased key.
const GATE_LABEL: Readonly<Record<string, string>> = {
  advisory_conflict: "Advisory conflict",
  has_st_or_balance_sheet: "Sales & trading or balance sheet",
  web_activity: "Web activity",
  solvent: "Solvent",
};

function columnLabel(axis: string): string {
  return GATE_LABEL[axis] ?? axisLabel(axis);
}

function orNoSource(cell: Cell): Cell {
  return cell === null ? NO_SOURCE : cell;
}

/** The workbook's Targets sheet: the firm, its tier and score, then profile, each axis and the id. */
export function targetsTable(rows: readonly ExportRow[]): Table {
  return {
    headers: [
      "Firm",
      "Tier",
      "Score",
      ...PROFILE_COLUMNS.map((c) => c.header),
      ...AXIS_KEYS.map(columnLabel),
      "Firm ID",
    ],
    rows: rows.map((r) => [
      r.firmName,
      r.tier,
      r.score,
      ...PROFILE_COLUMNS.map((c) => r[c.key] ?? null),
      ...AXIS_KEYS.map((a) => orNoSource(r[a] ?? null)),
      r.firmId,
    ]),
  };
}

/** The workbook's Citations sheet: one line per firm and axis. */
export function citationsTable(
  rows: readonly ExportRow[],
  citations: readonly Citation[][],
): Table {
  const out: Cell[][] = [];
  rows.forEach((r, i) => {
    for (const c of citations[i] ?? []) {
      out.push([
        r.firmName,
        columnLabel(c.axis),
        orNoSource(c.provider),
        orNoSource(c.quote),
        orNoSource(c.model),
      ]);
    }
  });
  return { headers: ["Firm", "Axis", "Provider", "Quote", "Model"], rows: out };
}

/** The tier and score as one line, for a CRM's free-text field. */
export function scoreLine(r: Pick<ExportRow, "tier" | "score">): string {
  return `Tier ${r.tier}, score ${r.score}/${MAX_POSSIBLE}`;
}

// ─── File names ──────────────────────────────────────────────────────────

function slugOf(text: string, max: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/**
 * `beacon-<name>[-<suffix>]-<yyyy-mm-dd>.<ext>`, with the name cut down to lowercase words and
 * hyphens. The name is shortened before the suffix is added, so a long name never cuts the
 * suffix off.
 */
export function exportFileName(
  name: string,
  ext: "xlsx" | "csv",
  now: Date,
  suffix?: string,
): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const parts = ["beacon", slugOf(name, 48) || "targets", slugOf(suffix ?? "", 16), day];
  return `${parts.filter(Boolean).join("-")}.${ext}`;
}
