import { describe, expect, it } from "vitest";
import { buildAxisRows } from "./axisRows.js";
import { type FindingLike } from "./axisState.js";
import {
  evidenceChecks,
  isAnalystEntered,
  pickReading,
  rejectReasonText,
} from "./evidenceModel.js";
import type { ProviderObservation } from "./summaries.js";
import { ENRICH_AXES } from "./vocab.js";

const axis = (name: string) => {
  const def = ENRICH_AXES.find((a) => a.axis === name);
  if (!def) {
    throw new Error(name);
  }
  return def;
};

const reading = (over: Partial<ProviderObservation>): ProviderObservation => ({
  provider: "dealdb",
  value: "12",
  confidence: "high",
  grounded: true,
  rejectReason: null,
  quote: "The firm reports 12 fee-earning professionals",
  documentId: "dealdb:f1",
  checks: { line: 2, valueInQuote: true, words: 6 },
  ...over,
});

describe("evidenceChecks", () => {
  it("passes the three checks for a grounded reading", () => {
    const checks = evidenceChecks(axis("fee_generating_count"), reading({}));
    expect(checks.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
    expect(checks.map((c) => c.detail)).toEqual(["line 2", '"12"', "6 words"]);
  });

  it("fails a quote that is not in the document and leaves the rest unchecked", () => {
    const checks = evidenceChecks(axis("fee_generating_count"), reading({ checks: null }));
    expect(checks.map((c) => c.status)).toEqual(["fail", "na", "na"]);
  });

  it("fails a value the quote does not contain", () => {
    const checks = evidenceChecks(
      axis("fee_generating_count"),
      reading({ checks: { line: 2, valueInQuote: false, words: 6 } }),
    );
    expect(checks[1].status).toBe("fail");
  });

  it("fails a quote too short to stand alone", () => {
    const checks = evidenceChecks(
      axis("fee_generating_count"),
      reading({ checks: { line: 2, valueInQuote: true, words: 3 } }),
    );
    expect(checks[2].status).toBe("fail");
  });

  it("does not hold a pass/fail gate to the value-in-quote check", () => {
    const checks = evidenceChecks(
      axis("solvent"),
      reading({ value: "true", checks: { line: 2, valueInQuote: false, words: 8 } }),
    );
    expect(checks[1]).toMatchObject({ status: "na", detail: "not required for gates" });
  });
});

describe("pickReading", () => {
  const readings = [
    reading({ provider: "beacondb", documentId: "beacondb:f1", value: null, grounded: null }),
    reading({ provider: "dealdb", documentId: "dealdb:f1" }),
    reading({ provider: "websearch", documentId: "websearch:f1", value: "9", confidence: "low" }),
  ];
  const finding: FindingLike = {
    findingId: "a",
    axis: "fee_generating_count",
    value: "9",
    provider: "websearch",
    sourceDocumentId: "websearch:f1",
  };

  it("prefers the reading the finding cites", () => {
    const [row] = buildAxisRows([axis("fee_generating_count")], undefined, [finding]);
    expect(pickReading({ ...row, readings }, finding)?.provider).toBe("websearch");
  });

  it("otherwise takes the first reading that has a value", () => {
    const [row] = buildAxisRows([axis("fee_generating_count")], undefined, []);
    expect(pickReading({ ...row, readings }, undefined)?.provider).toBe("dealdb");
  });

  it("has nothing to pick when no provider said anything", () => {
    const [row] = buildAxisRows([axis("fee_generating_count")], undefined, []);
    expect(pickReading({ ...row, readings: [] }, undefined)).toBeUndefined();
  });
});

describe("rejectReasonText", () => {
  it("says what happened in plain words and passes unknown reasons through", () => {
    expect(rejectReasonText("quote_not_in_document")).toMatch(/not in the source/i);
    expect(rejectReasonText("something_new")).toBe("something_new");
  });
});

describe("isAnalystEntered", () => {
  it("is true for a verified finding with no source document", () => {
    expect(isAnalystEntered("verified", { sourceDocumentId: null })).toBe(true);
    expect(isAnalystEntered("verified", {})).toBe(true);
  });

  it("is false for a cited finding, an abstention, or no finding", () => {
    expect(isAnalystEntered("proposed", { sourceDocumentId: "dealdb:f1" })).toBe(false);
    expect(isAnalystEntered("abstained", { sourceDocumentId: null })).toBe(false);
    expect(isAnalystEntered("empty", undefined)).toBe(false);
  });
});
