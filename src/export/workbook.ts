import {
  type Cell,
  type Citation,
  type ExportRow,
  citationsTable,
  targetsTable,
} from "../../shared/exportRows";

/** A column wide enough for its header and typical cells, within [10, 60] characters. */
function widths(headers: string[], rows: Cell[][], cap = 60): { width: number }[] {
  return headers.map((h, i) => {
    let widest = h.length;
    for (const r of rows.slice(0, 200)) {
      widest = Math.max(widest, String(r[i] ?? "").length);
    }
    return { width: Math.min(cap, Math.max(10, widest + 2)) };
  });
}

// Every text cell is a string cell, which Excel never evaluates, whatever it starts with. The
// text stays as it is: no apostrophe.
function plain(c: Cell) {
  if (typeof c === "string") {
    return { value: c, type: String };
  }
  return typeof c === "number" ? { value: c, type: Number } : null;
}

/**
 * The workbook: Targets (tier, score, profile and each axis) and Citations (where each value
 * came from). The writer is fetched here, on the first export, so it is not in any page's bundle.
 */
export async function buildWorkbook(
  rows: readonly ExportRow[],
  citations: readonly Citation[][],
): Promise<Blob> {
  // The universal build writes on this thread; the browser build starts a worker from a blob URL,
  // which the Content-Security-Policy does not allow.
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const targets = targetsTable(rows);
  const cites = citationsTable(rows, citations);
  const sheet = (t: { headers: string[]; rows: Cell[][] }) => [
    t.headers.map((h) => ({ value: h, fontWeight: "bold" as const })),
    ...t.rows.map((r) => r.map(plain)),
  ];
  return writeExcelFile([
    {
      sheet: "Targets",
      data: sheet(targets),
      columns: widths(targets.headers, targets.rows),
      stickyRowsCount: 1,
      stickyColumnsCount: 1,
    },
    {
      sheet: "Citations",
      data: sheet(cites),
      columns: widths(cites.headers, cites.rows),
      stickyRowsCount: 1,
    },
  ]).toBlob();
}
