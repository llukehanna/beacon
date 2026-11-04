import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resetDemo } from "../seed/reset.js";
import { generateUniverse } from "../seed/universe.js";
import { createTestDb } from "../testing.js";
import { EXTRACTION_PROMPT_VERSION, ruleBasedExtraction } from "./contract.js";
import { documentsHash, firmDocuments } from "./documents.js";
import {
  type FixtureRecord,
  fixtureToExtractionRows,
  parseFixtureLines,
  planFixtureRepair,
} from "./fixtures.js";

const firm = generateUniverse(5)[0];
const docs = firmDocuments(firm);
const MODEL = "claude-haiku-4-5";
const NOW = new Date("2026-11-04T12:00:00.000Z");

function record(overrides: Partial<FixtureRecord> = {}): FixtureRecord {
  return {
    firmId: firm.firmId!,
    model: MODEL,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    documentsHash: documentsHash(docs),
    createdAt: NOW.toISOString(),
    output: ruleBasedExtraction(docs),
    usage: { inputTokens: 1200, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.0017,
    latencyMs: null,
    batchId: "msgbatch_test",
    ...overrides,
  };
}

describe("parseFixtureLines", () => {
  it("skips blank and broken lines", () => {
    const good = record();
    const text = [
      JSON.stringify(good),
      "",
      "   ",
      "{not json",
      JSON.stringify({ firmId: "x" }), // valid JSON, not a record
      JSON.stringify({ ...good, output: null }),
    ].join("\n");
    const records = parseFixtureLines(text);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(good);
    expect(records[1].output).toBeNull();
  });
});

describe("planFixtureRepair", () => {
  const line = JSON.stringify(record({ batchId: "msgbatch_é" })); // multi-byte, to check byte offsets

  it("leaves empty text and text ending in a newline alone", () => {
    expect(planFixtureRepair("")).toEqual({ addNewline: false, keepBytes: null });
    expect(planFixtureRepair(`${line}\n`)).toEqual({ addNewline: false, keepBytes: null });
  });

  it("asks for the missing newline after a whole record", () => {
    expect(planFixtureRepair(line)).toEqual({ addNewline: true, keepBytes: null });
  });

  it("truncates to the last newline, in bytes, when the last line is a fragment", () => {
    const whole = `${line}\n`;
    expect(planFixtureRepair(`${whole}${line.slice(0, 40)}`)).toEqual({
      addNewline: false,
      keepBytes: Buffer.byteLength(whole),
    });
    expect(planFixtureRepair(line.slice(0, 40))).toEqual({ addNewline: false, keepBytes: 0 });
  });

  it("leaves a file that the next append parses cleanly, on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "fixture-repair-"));
    try {
      const path = join(dir, "m.jsonl");
      writeFileSync(path, `${line}\n${line.slice(0, 40)}`);
      const plan = planFixtureRepair(readFileSync(path, "utf8"));
      truncateSync(path, plan.keepBytes!);
      appendFileSync(path, `${line}\n`);
      expect(parseFixtureLines(readFileSync(path, "utf8"))).toHaveLength(2);

      writeFileSync(path, line); // whole record, no newline
      expect(planFixtureRepair(readFileSync(path, "utf8")).addNewline).toBe(true);
      appendFileSync(path, "\n");
      appendFileSync(path, `${line}\n`);
      expect(parseFixtureLines(readFileSync(path, "utf8"))).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("fixtureToExtractionRows", () => {
  it("returns [] for null output, stale hash, or stale prompt version", () => {
    expect(fixtureToExtractionRows(record({ output: null }), firm, NOW)).toEqual([]);
    expect(fixtureToExtractionRows(record({ documentsHash: "00000000" }), firm, NOW)).toEqual([]);
    expect(fixtureToExtractionRows(record({ promptVersion: "extract-v0" }), firm, NOW)).toEqual([]);
    expect(fixtureToExtractionRows(record({ firmId: "someone-else" }), firm, NOW)).toEqual([]);
    expect(fixtureToExtractionRows(record(), firm, NOW).length).toBeGreaterThan(0);
  });

  it("gives one grounded row per item with a value", () => {
    const rec = record();
    const rows = fixtureToExtractionRows(rec, firm, NOW);
    expect(rows).toHaveLength(rec.output!.items.length);
    expect(new Set(rows.map((r) => r.extractionId)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.extractionId).toBe(`${r.firmId}|${MODEL}|${r.provider}|${r.axis}`);
      expect(r.grounded).toBe(true);
      expect(r.rejectReason).toBeNull();
      expect(r.promptVersion).toBe(EXTRACTION_PROMPT_VERSION);
      expect(r.extractedAt).toBe(NOW.toISOString());
    }
  });

  it("marks ungrounded items", () => {
    const rec = record();
    const [first, ...rest] = rec.output!.items;
    rec.output = {
      items: [{ ...first, quote: "This sentence appears in no source document at all." }, ...rest],
    };
    const rows = fixtureToExtractionRows(rec, firm, NOW);
    const bad = rows.find((r) => r.provider === first.provider && r.axis === first.axis)!;
    expect(bad.grounded).toBe(false);
    expect(bad.rejectReason).toBe("quote_not_in_document");
    expect(rows.filter((r) => r.grounded)).toHaveLength(rows.length - 1);
  });

  it("skips null values and keeps one row for a repeated provider and axis", () => {
    const rec = record();
    const first = rec.output!.items[0];
    rec.output = {
      items: [
        { ...first, quote: "Not in the document, so rejected." },
        first, // the grounded repeat wins
        { ...rec.output!.items[1], value: null, quote: null },
      ],
    };
    const rows = fixtureToExtractionRows(rec, firm, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].grounded).toBe(true);
  });
});

describe("resetDemo with fixtures", () => {
  it("loads fixture rows", async () => {
    const db = await createTestDb();
    const rec = record();
    const stranger = record({ firmId: "no-such-firm" });
    await resetDemo(db, NOW, { fixtures: [rec, stranger] });
    const rows = await db.query<{ firmId: string; grounded: boolean }>(
      `SELECT "firmId", grounded FROM extraction`,
    );
    expect(rows).toHaveLength(rec.output!.items.length);
    expect(rows.every((r) => r.firmId === firm.firmId && r.grounded)).toBe(true);
  }, 300_000);
});
