import { useState } from "react";
import { MenuButton, type MenuItem } from "@/ui";
import { CRM_FORMATS, type CrmName } from "../../shared/crmFormats";
import {
  type FindingLike,
  type FirmLike,
  exportFileName,
  exportRows,
  toCsv,
} from "../../shared/exportRows";
import styles from "./ExportMenu.module.css";
import { csvBlob, saveBlob } from "./download";
import { fetchAllFindings } from "./fetchFindings";

const CRMS: readonly CrmName[] = ["salesforce", "dealcloud", "affinity"];

type Kind = "xlsx" | CrmName;

/**
 * One Export menu for a list of firms: an Excel workbook with the evidence behind every value, or
 * a CSV for each CRM. The findings are fetched when a format is chosen, not when the page loads,
 * and the workbook writer is fetched on the first Excel export.
 */
export function ExportMenu({
  name,
  firms,
  findings,
}: {
  /** What the list is, for the file name: the mandate's name, "pipeline", … */
  name: string;
  firms: readonly FirmLike[];
  /** The findings the page already holds; fetched when the export is asked for if it has none. */
  findings?: readonly FindingLike[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: Kind): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { rows, citations } = exportRows(firms, findings ?? (await fetchAllFindings()));
      const now = new Date();
      if (kind === "xlsx") {
        const { buildWorkbook } = await import("./workbook");
        saveBlob(await buildWorkbook(rows, citations), exportFileName(name, "xlsx", now));
      } else {
        const fmt = CRM_FORMATS[kind];
        const csv = toCsv(fmt.headers, rows.map(fmt.map));
        saveBlob(csvBlob(csv), exportFileName(name, "csv", now, fmt.label));
      }
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const items: MenuItem[] = [
    {
      id: "xlsx",
      label: "Excel workbook",
      hint: "Targets and citations, .xlsx",
      onSelect: () => void run("xlsx"),
    },
    ...CRMS.map((crm) => ({
      id: crm,
      label: `CSV for ${CRM_FORMATS[crm].label}`,
      hint: "Import template, map fields on upload",
      onSelect: () => void run(crm),
    })),
  ];

  return (
    <span className={styles.export}>
      <MenuButton
        label={busy ? "Exporting…" : "Export"}
        items={items}
        busy={busy}
        disabled={firms.length === 0}
      />
      {error !== null && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
