import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateUniverse } from "../seed/universe.js";
import { EXTRACTION_PROMPT_VERSION } from "./contract.js";
import { documentsHash, firmDocuments } from "./documents.js";
import { parseFixtureLines } from "./fixtures.js";

// A change to a document template, the prompt, or the universe makes every recorded extraction
// stale, and the seed then falls back to rule-based values without a sound. This fails first.
const dir = fileURLToPath(new URL("../../fixtures/extraction/", import.meta.url));
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
  : [];
const firms = new Map(generateUniverse().map((f) => [f.firmId!, f]));

describe.skipIf(files.length === 0)(
  "committed extraction fixtures (skipped: no fixtures/extraction/*.jsonl committed yet)",
  () => {
    for (const file of files) {
      it(`${file} matches the current prompt version and documents`, () => {
        const text = readFileSync(`${dir}${file}`, "utf8");
        const records = parseFixtureLines(text);
        const lines = text.split("\n").filter((l) => l.trim() !== "");
        expect(records.length, "every line is a valid record").toBe(lines.length);
        const stale: string[] = [];
        for (const record of records) {
          const firm = firms.get(record.firmId);
          if (
            firm === undefined ||
            record.promptVersion !== EXTRACTION_PROMPT_VERSION ||
            record.documentsHash !== documentsHash(firmDocuments(firm))
          ) {
            stale.push(record.firmId);
          }
        }
        expect(
          stale,
          `stale records (rerun \`npm run extract\`): ${stale.slice(0, 5).join(", ")}`,
        ).toEqual([]);
      });
    }
  },
);
