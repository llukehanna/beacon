import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";
import { type EvidenceDecision, buildRejectionNotes } from "./ruleEvidence";

const decisions = new Map<string, EvidenceDecision>([
  [
    "d1",
    {
      decisionId: "d1",
      firmId: "f1",
      rejectionRationale: " Too small ",
      decidedAt: "2026-01-05T00:00:00Z",
    },
  ],
  [
    "d2",
    {
      decisionId: "d2",
      firmId: "f2",
      rejectionRationale: "Trading desk",
      decidedAt: "2026-03-01T00:00:00Z",
    },
  ],
  [
    "d3",
    {
      decisionId: "d3",
      firmId: "f1",
      rejectionRationale: "   ",
      decidedAt: "2026-02-01T00:00:00Z",
    },
  ],
  ["d4", { decisionId: "d4", firmId: "gone", rejectionRationale: "No dated note" }],
]);
const firms = new Map([
  ["f1", "Alpha Partners"],
  ["f2", "Beta Advisory"],
]);

describe("buildRejectionNotes", () => {
  it("quotes the rationale with firm and date, newest first, undated last", () => {
    const notes = buildRejectionNotes(["d1", "d2", "d4"], decisions, firms);
    expect(notes.map((n) => n.decisionId)).toEqual(["d2", "d1", "d4"]);
    expect(notes[1]).toMatchObject({ note: "Too small", firmName: "Alpha Partners" });
    expect(notes[1].decidedAtMs).toBe(Date.parse("2026-01-05T00:00:00Z"));
    expect(notes[2]).toMatchObject({ firmName: "Firm not on file", decidedAtMs: null });
  });

  it("drops blank rationales, unknown ids and duplicates", () => {
    const notes = buildRejectionNotes(["d3", "missing", "d1", "d1"], decisions, firms);
    expect(notes.map((n) => n.decisionId)).toEqual(["d1"]);
  });
});

describe("GLOSSARY", () => {
  it("defines every term the desk wraps", () => {
    for (const k of [
      "CF",
      "CS",
      "Model: both",
      "S&T / balance sheet",
      "Coverage",
      "Hard gate",
      "Drift",
      "Tier",
      "Abstention",
    ]) {
      expect(GLOSSARY[k]).toBeTruthy();
    }
  });
});
