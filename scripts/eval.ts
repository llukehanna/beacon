import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asFirmObject, extractionRowsFromFixtures } from "../server/eval/pipeline.js";
import {
  buildReport,
  failedThresholds,
  renderJson,
  renderMarkdown,
  staleFiles,
} from "../server/eval/report.js";
import { generateUniverse } from "../server/seed/universe.js";
import { loadExtractionFixtures } from "./fixture-files.js";

// Runs the agent's pipeline over the whole generated universe, in memory, and measures it
// against the universe's hidden truth. Reads the committed extraction recordings, so it needs no
// database, network or API key. `npm run eval` writes docs/evals.md and docs/evals.json;
// `npm run eval -- --check` writes nothing and exits non-zero when a threshold fails or a
// committed file is out of date.
const check = process.argv.includes("--check");
const files = {
  "docs/evals.json": fileURLToPath(new URL("../docs/evals.json", import.meta.url)),
  "docs/evals.md": fileURLToPath(new URL("../docs/evals.md", import.meta.url)),
} as const;

const firms = generateUniverse().map(asFirmObject);
const rows = extractionRowsFromFixtures(loadExtractionFixtures(), firms);
const report = await buildReport(firms, rows);
const fresh = { json: renderJson(report), md: renderMarkdown(report) };
const failed = failedThresholds(report);

const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
console.log(`eval (against synthetic ground truth): ${report.firms} firms`);
console.log(`  extraction read: ${report.generatedFrom.fixtures}`);
for (const p of report.providers) {
  console.log(`  ${p.provider}: coverage ${pct(p.coverage)}, precision ${pct(p.precision)}`);
}
console.log(
  `  reconciled: coverage ${pct(report.reconciled.coverage)}, precision ${pct(report.reconciled.precision)}, conflicts ${pct(report.reconciled.conflictRate)}, higher-trust right ${pct(report.reconciled.higherTrustRight)}`,
);
console.log(
  `  abstention: rate ${pct(report.abstention.rate)}, calibration ${pct(report.abstention.calibration)}`,
);
console.log(`  tier agreement: ${pct(report.tierAgreement)}`);
console.log(
  `  rule recovery: ${report.ruleRecovery.recovered}/${report.ruleRecovery.planted} (${report.ruleRecovery.method})`,
);

if (failed.length > 0) {
  console.error(`below threshold: ${failed.join(", ")}`);
}

if (check) {
  const stale = staleFiles(
    {
      "docs/evals.json": existsSync(files["docs/evals.json"])
        ? readFileSync(files["docs/evals.json"], "utf8")
        : null,
      "docs/evals.md": existsSync(files["docs/evals.md"])
        ? readFileSync(files["docs/evals.md"], "utf8")
        : null,
    },
    fresh,
  );
  if (stale.length > 0) {
    console.error(`out of date (run \`npm run eval\` and commit): ${stale.join(", ")}`);
  }
  if (failed.length > 0 || stale.length > 0) {
    process.exit(1);
  }
  console.log("eval --check: thresholds met, committed report is current");
} else {
  writeFileSync(files["docs/evals.json"], fresh.json);
  writeFileSync(files["docs/evals.md"], fresh.md);
  console.log("wrote docs/evals.md and docs/evals.json");
}
