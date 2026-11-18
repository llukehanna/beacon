import { describe, expect, it } from "vitest";
import { ADVISORY_ACQUISITIONS } from "../workspaces/advisoryAcquisitions.js";
import type { WorkspaceDefinition } from "../workspaces/types.js";
import { RubricError } from "./definition.js";
import { validateWorkspace } from "./workspace.js";

const clone = (): WorkspaceDefinition =>
  JSON.parse(JSON.stringify(ADVISORY_ACQUISITIONS)) as WorkspaceDefinition;

describe("validateWorkspace", () => {
  it("accepts the advisory-acquisitions workspace", () => {
    expect(() => validateWorkspace(ADVISORY_ACQUISITIONS)).not.toThrow();
  });

  it("refuses a criterion on a profile trait", () => {
    const ws = clone();
    ws.rubric.theses[0].criteria.push({
      traitKey: "revenue_band",
      label: "Revenue",
      weight: 1,
      scoring: { type: "category", options: [{ value: "<$10M", points: 0 }] },
    });
    expect(() => validateWorkspace(ws)).toThrow(/revenue_band/);
  });

  it("refuses a hard reject on a profile trait", () => {
    const ws = clone();
    ws.rubric.theses[0].hardRejects.push({
      traitKey: "ownership",
      operator: "==",
      value: "PE-backed",
      reason: "x",
    });
    expect(() => validateWorkspace(ws)).toThrow(RubricError);
  });

  it("refuses a criterion on an undeclared trait", () => {
    const ws = clone();
    ws.rubric.theses[0].criteria[0].traitKey = "nope";
    expect(() => validateWorkspace(ws)).toThrow(/nope/);
  });

  it("refuses band scoring on a category trait", () => {
    const ws = clone();
    // CF does not score balance_sheet_principal, so this introduces no duplicate.
    const c = ws.rubric.theses[0].criteria.find((x) => x.traitKey === "deal_size_usd_m");
    c!.traitKey = "balance_sheet_principal";
    expect(() => validateWorkspace(ws)).toThrow(/balance_sheet_principal/);
  });

  it("refuses a scored option missing from the trait's vocabulary", () => {
    const ws = clone();
    const c = ws.rubric.theses[0].criteria[0];
    if (c.scoring.type !== "category") {
      throw new Error("first criterion should be categorical");
    }
    c.scoring.options[0].value = "Somewhere else";
    expect(() => validateWorkspace(ws)).toThrow(/Somewhere else/);
  });

  it("refuses a candidate screen on an undeclared trait", () => {
    const ws = clone();
    ws.rubric.candidateScreens[0].axis = "nope";
    expect(() => validateWorkspace(ws)).toThrow(/nope/);
  });

  it("refuses duplicate trait keys", () => {
    const ws = clone();
    ws.traits.push(ws.traits[0]);
    expect(() => validateWorkspace(ws)).toThrow(RubricError);
  });
});

describe("the advisory-acquisitions catalog", () => {
  it("lists the 11 evidence traits first, then facts, then profile fields", () => {
    expect(ADVISORY_ACQUISITIONS.traits.map((t) => `${t.role}:${t.traitKey}`)).toEqual([
      "evidence:services_fit",
      "evidence:md_pedigree",
      "evidence:balance_sheet_principal",
      "evidence:deal_size_usd_m",
      "evidence:deals_per_md_l3y",
      "evidence:firm_age",
      "evidence:fee_generating_count",
      "evidence:advisory_conflict",
      "evidence:has_st_or_balance_sheet",
      "evidence:web_activity",
      "evidence:solvent",
      "fact:coverage_model",
      "fact:geo_score",
      "fact:employees",
      "profile:revenue_band",
      "profile:ownership",
      "profile:succession_risk",
    ]);
  });

  it("names a catalog trait for every old firm column", () => {
    const keys = new Set(ADVISORY_ACQUISITIONS.traits.map((t) => t.traitKey));
    const aliased = new Set(Object.values(ADVISORY_ACQUISITIONS.legacyFieldAliases));
    expect(aliased.size).toBe(17);
    expect([...aliased].filter((k) => !keys.has(k))).toEqual([]);
  });

  it("refuses a whole-number flag on a trait that is not a number", () => {
    const traits = ADVISORY_ACQUISITIONS.traits.map((t) =>
      t.traitKey === "solvent" ? { ...t, wholeNumber: true } : t,
    );
    expect(() => validateWorkspace({ ...ADVISORY_ACQUISITIONS, traits })).toThrow(
      /solvent.*whole numbers/,
    );
  });

  it("aliases the action spelling of the S&T gate", () => {
    expect(ADVISORY_ACQUISITIONS.legacyFieldAliases.hasStOrBalanceSheet).toBe(
      "has_st_or_balance_sheet",
    );
  });
});
