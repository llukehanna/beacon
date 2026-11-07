/**
 * Column maps for the three CRMs a target list is loaded into. Pure: a header list and a function
 * from an export row to a cell list of the same length, per CRM.
 */
import { type Cell, type ExportRow, scoreLine } from "./exportRows.js";

export type CrmName = "salesforce" | "dealcloud" | "affinity";

export interface CrmFormat {
  label: string;
  headers: string[];
  map: (r: ExportRow) => Cell[];
}

const RATING: Readonly<Record<string, string>> = { A: "Hot", B: "Warm", C: "Cold" };

const str = (v: string | number | null | undefined): Cell => v ?? null;

// These header lists are import templates modelled on each CRM's standard import fields: map them
// to your own fields on upload.
export const CRM_FORMATS: Record<CrmName, CrmFormat> = {
  // Salesforce Account import.
  salesforce: {
    label: "Salesforce",
    headers: [
      "Account Name",
      "Billing Country",
      "Industry",
      "Employees",
      "Ownership",
      "Rating",
      "Account Source",
      "Description",
      "Beacon Firm ID",
    ],
    map: (r) => [
      r.firmName,
      str(r.hqCountry),
      str(r.sector),
      str(r.employees),
      str(r.ownership),
      RATING[r.tier] ?? null,
      "Beacon",
      scoreLine(r),
      r.firmId,
    ],
  },
  // DealCloud company import.
  dealcloud: {
    label: "DealCloud",
    headers: [
      "Company Name",
      "Company Type",
      "HQ Country",
      "Industry",
      "Employee Count",
      "Revenue Band",
      "Ownership Type",
      "Pipeline Stage",
      "Beacon Tier",
      "Beacon Score",
      "Beacon Firm ID",
    ],
    map: (r) => [
      r.firmName,
      str(r.firmType),
      str(r.hqCountry),
      str(r.sector),
      str(r.employees),
      str(r.revenueBand),
      str(r.ownership),
      str(r.stage),
      r.tier,
      r.score,
      r.firmId,
    ],
  },
  // Affinity organization list import.
  affinity: {
    label: "Affinity",
    headers: [
      "Organization Name",
      "Location",
      "Industry",
      "Employees",
      "Status",
      "Tier",
      "Score",
      "Succession Risk",
      "Source",
      "Beacon Firm ID",
    ],
    map: (r) => [
      r.firmName,
      str(r.hqCountry),
      str(r.sector),
      str(r.employees),
      str(r.stage),
      r.tier,
      r.score,
      str(r.successionRisk),
      "Beacon",
      r.firmId,
    ],
  },
};
