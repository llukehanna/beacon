/**
 * The data-driven rubric must score exactly like the hand-written rubric v2
 * it replaces, on every input: the oracle is a frozen copy of that module.
 */
import { describe, expect, it } from "vitest";
import { rng } from "../../server/enrichment/random.js";
import { axisPoints } from "../scoring.js";
import { ENRICH_AXES } from "../vocab.js";
import { ADVISORY_ACQUISITIONS as WS } from "../workspaces/advisoryAcquisitions.js";
import { type ScoreInput, mirrorScore } from "./__oracle__/legacyRubricV2.js";
import { parseRubricDefinition } from "./definition.js";
import { criterionPoints, maxPossible, scoreTraits } from "./engine.js";
import { thesisOf } from "./firm.js";
import { legacyTraits } from "./workspace.js";

type Value = string | number | boolean | null;
const DEF = WS.rubric;
const optionsOf = (key: string): string[] => WS.traits.find((t) => t.traitKey === key)!.options!;
const edges = (lo: number, hi: number): number[] =>
  [lo, hi].flatMap((e) => [e - 0.01, e, e + 0.01]).concat([0, 1e6]);

/** Every value worth trying per legacy field. Off-label coverage is excluded (spec). */
const POOL: Readonly<Record<string, readonly Value[]>> = {
  coverageModel: [null, ...optionsOf("coverage_model")],
  servicesFit: [null, "other", ...optionsOf("services_fit")],
  mdPedigree: [null, "other", ...optionsOf("md_pedigree")],
  balanceSheetPrincipal: [null, "other", ...optionsOf("balance_sheet_principal")],
  geoScore: [null, -1, 0, 1, 1.5, 2, 3],
  dealSizeMUsd: [null, ...edges(25, 150)],
  dealsPerMdL3y: [null, ...edges(1.5, 3.5)],
  firmAge: [null, ...edges(5, 12)],
  employees: [null, ...edges(8, 40)],
  feeGeneratingCount: [null, ...edges(2, 3), 3.5],
  advisoryConflict: [null, true, false],
};
const THESES: readonly Value[] = ["CF", "CS", "cs", " CS ", null, "other"];

function same(firm: Record<string, Value>): void {
  const engine = scoreTraits(DEF, thesisOf(firm), legacyTraits(WS, firm));
  expect(engine).toEqual(mirrorScore(firm as ScoreInput));
}

const STRONG_CF: Record<string, Value> = {
  firmType: "CF",
  coverageModel: "Single-sector focus",
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  geoScore: 2,
  dealSizeMUsd: 200,
  dealsPerMdL3y: 5,
  firmAge: 15,
  employees: 20,
  feeGeneratingCount: 4,
};
const STRONG_CS: Record<string, Value> = {
  ...STRONG_CF,
  firmType: "CS",
  balanceSheetPrincipal: "Advisory only",
  servicesFit: "Full private-capital suite",
  mdPedigree: "Senior credit / capital-markets pedigree",
};

describe("rubric v1 as data matches rubric v2 in code", () => {
  it("is a valid definition worth 18 points per thesis", () => {
    expect(parseRubricDefinition(DEF)).toEqual(DEF);
    expect(DEF.theses.map(maxPossible)).toEqual([18, 18]);
  });

  it("matches on the strong firms", () => {
    same(STRONG_CF);
    same(STRONG_CS);
  });

  it("matches when any single field takes any pooled value", () => {
    for (const base of [STRONG_CF, STRONG_CS]) {
      for (const [field, values] of Object.entries(POOL)) {
        for (const v of values) {
          same({ ...base, [field]: v });
        }
      }
    }
  });

  it("matches on 20,000 random firms", () => {
    const r = rng("parity");
    const pickFrom = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 20_000; i++) {
      const firm: Record<string, Value> = { firmType: pickFrom(THESES) };
      for (const [field, values] of Object.entries(POOL)) {
        firm[field] = pickFrom(values);
      }
      same(firm);
    }
  });

  it("scores a lone finding value exactly like axisPoints", () => {
    for (const thesis of ["CF", "CS"]) {
      for (const axis of ENRICH_AXES) {
        const values: Value[] = [null, ...(POOL[axis.firmField] ?? [true, false])];
        for (const v of values) {
          expect(criterionPoints(DEF, thesis, axis.axis, v)).toBe(
            axisPoints({ firmType: thesis }, axis, v),
          );
        }
      }
    }
  });
});
