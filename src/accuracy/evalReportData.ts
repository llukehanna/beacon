import evalReportJson from "../../docs/evals.json";
import type { EvalReport } from "../../shared/evalReport";

/**
 * Written by `npm run eval` and bundled at build time; `server/eval` checks it is current in CI.
 * The JSON import widens the report's literal unions to string, so this is the one place it is
 * narrowed back: the file is generated from EvalReport.
 */
export const EVAL_REPORT = evalReportJson as unknown as EvalReport;
