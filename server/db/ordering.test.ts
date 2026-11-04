import { describe, expect, it } from "vitest";
import type { ObjectOf } from "../../shared/schema.js";
import { sortedRows } from "./ordering.js";

const firm = (id: string, name?: string): ObjectOf<"Firm"> => ({
  $apiName: "Firm",
  $primaryKey: id,
  firmId: id,
  firmName: name,
});

describe("sortedRows", () => {
  it("orders text by code unit, ignoring punctuation rules and case folding", () => {
    // A locale collation would put "Ab" before "A, B" (punctuation ignored) and "a" before "B".
    const rows = [firm("1", "Ab"), firm("2", "A, B"), firm("3", "a"), firm("4", "B")];
    expect(sortedRows("Firm", rows, ["firmName"]).map((r) => r.firmName)).toEqual([
      "A, B",
      "Ab",
      "B",
      "a",
    ]);
  });

  it("breaks ties by primary key and puts missing values last", () => {
    const rows = [firm("b", "X"), firm("c"), firm("a", "X")];
    expect(sortedRows("Firm", rows, ["firmName"]).map((r) => r.$primaryKey)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
