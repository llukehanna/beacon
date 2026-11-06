import { describe, expect, it } from "vitest";
import type { EvalReport } from "../../shared/evalReport.js";
import { generateUniverse } from "../seed/universe.js";
import { asFirmObject } from "./pipeline.js";
import {
  THRESHOLDS,
  buildReport,
  failedThresholds,
  renderJson,
  renderMarkdown,
  staleFiles,
} from "./report.js";

const sample = generateUniverse(40).map(asFirmObject);

const base: EvalReport = {
  version: 1,
  generatedFrom: { documents: "doc-v1", prompt: "extract-v1", fixtures: "rule-based" },
  firms: 10,
  providers: [{ provider: "dealdb", coverage: 0.7, precision: 0.97 }],
  reconciled: { coverage: 0.7, precision: 0.95, conflictRate: 0.03, higherTrustRight: 0.9 },
  abstention: { rate: 0.3, calibration: 1 },
  tierAgreement: 0.6,
  ruleRecovery: { planted: 4, recovered: 4, method: "heuristic" },
  thresholds: {},
  passed: true,
};

describe("buildReport", () => {
  it("is deterministic and names what it was generated from", async () => {
    const a = await buildReport(sample, []);
    expect(a).toEqual(await buildReport(sample, []));
    expect(a.version).toBe(1);
    expect(a.firms).toBe(40);
    expect(a.generatedFrom).toEqual({
      documents: "doc-v1",
      prompt: "extract-v1",
      fixtures: "rule-based",
    });
    expect(a.thresholds).toEqual(THRESHOLDS);
  });
});

describe("failedThresholds", () => {
  const withFloors = { ...base, thresholds: { "reconciled.precision": 0.9, tierAgreement: 0.5 } };

  it("is empty when every figure reaches its floor", () => {
    expect(failedThresholds(withFloors)).toEqual([]);
  });

  it("names a figure below its floor, and one that could not be measured", () => {
    expect(failedThresholds({ ...withFloors, tierAgreement: 0.4 })).toEqual(["tierAgreement"]);
    expect(failedThresholds({ ...withFloors, tierAgreement: null })).toEqual(["tierAgreement"]);
  });
});

describe("renderMarkdown", () => {
  it("labels the figures as measured against synthetic ground truth", () => {
    const md = renderMarkdown({ ...base, thresholds: { tierAgreement: 0.5 } });
    expect(md).toContain("against synthetic ground truth");
    expect(md).toContain("60.0%");
    expect(md).toContain("npm run eval");
  });

  it("shows a figure with nothing to measure as n/a", () => {
    expect(renderMarkdown({ ...base, tierAgreement: null })).toContain("n/a");
  });
});

describe("eval --check", () => {
  const fresh = { json: renderJson(base), md: renderMarkdown(base) };

  it("accepts committed files that match the regenerated ones", () => {
    expect(staleFiles({ "docs/evals.json": fresh.json, "docs/evals.md": fresh.md }, fresh)).toEqual(
      [],
    );
  });

  it("detects a stale report", () => {
    const mutated = renderJson({ ...base, tierAgreement: 0.61 });
    expect(staleFiles({ "docs/evals.json": mutated, "docs/evals.md": fresh.md }, fresh)).toEqual([
      "docs/evals.json",
    ]);
  });

  it("treats a missing committed file as stale", () => {
    expect(staleFiles({ "docs/evals.json": null, "docs/evals.md": null }, fresh)).toEqual([
      "docs/evals.json",
      "docs/evals.md",
    ]);
  });
});
