import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  LINKS,
  OBJECT_TYPES,
  findLink,
  isActionName,
  isObjectTypeName,
} from "./schema.js";

describe("ontology schema", () => {
  it("declares each primary key as a string property", () => {
    for (const t of Object.values(OBJECT_TYPES)) {
      expect((t.properties as Record<string, string>)[t.primaryKey], t.apiName).toBe("string");
    }
  });

  it("uses unique table names", () => {
    const tables = Object.values(OBJECT_TYPES).map((t) => t.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("links only between declared types", () => {
    for (const l of LINKS) {
      expect(isObjectTypeName(l.source)).toBe(true);
      expect(isObjectTypeName(l.target)).toBe(true);
    }
    expect(findLink("Search", "firms")?.joinTable).toBe("search_membership");
    expect(findLink("Firm", "nope")).toBeUndefined();
  });

  it("names the 18 actions the app and seed use", () => {
    expect(ACTION_NAMES).toHaveLength(18);
    expect(isActionName("qualifyFirm")).toBe(true);
    expect(isActionName("dropTables")).toBe(false);
  });

  it("keeps no trait as a Firm property: traits are trait values", () => {
    const p: Readonly<Record<string, string>> = OBJECT_TYPES.Firm.properties;
    expect(p.thesis).toBe("string");
    for (const gone of [
      "firmType",
      "dealsPerMdL3y",
      "hasSTOrBalanceSheet",
      "employees",
      "ownership",
    ]) {
      expect(p[gone]).toBeUndefined();
    }
    expect(OBJECT_TYPES.Trait.properties.wholeNumber).toBe("boolean");
  });
});
