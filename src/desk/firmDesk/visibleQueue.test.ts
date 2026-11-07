import { describe, expect, it } from "vitest";
import { nextAfterPass } from "../deskDefaults";
import { type RankedFirm } from "../queue";
import { visibleQueue } from "./visibleQueue";

const row = (firmId: string, firmName: string, employees = 50): RankedFirm =>
  ({ firm: { firmId, firmName, employees, firmType: "CF" } }) as unknown as RankedFirm;

const queue = [
  row("a", "Alder Partners"),
  row("b", "Birch Capital", 4),
  row("c", "Cedar Advisory"),
];
const base = {
  query: "",
  showAll: false,
  membershipPinned: false,
  screeningRules: [],
  openIds: new Set(["a", "b"]),
};
const ids = (rows: RankedFirm[]) => rows.map((r) => r.firm.firmId);

describe("visibleQueue", () => {
  it("lists the live queue by default, and every firm when asked", () => {
    expect(ids(visibleQueue(queue, base))).toEqual(["a", "b"]);
    expect(ids(visibleQueue(queue, { ...base, showAll: true }))).toEqual(["a", "b", "c"]);
    expect(ids(visibleQueue(queue, { ...base, membershipPinned: true }))).toEqual(["a", "b", "c"]);
  });

  it("narrows to the search text, by name or id, across firms the live queue leaves out", () => {
    expect(ids(visibleQueue(queue, { ...base, query: " cedar " }))).toEqual(["c"]);
    expect(ids(visibleQueue(queue, { ...base, query: "b" }))).toEqual(["b"]);
  });
});

describe("nextAfterPass", () => {
  it("opens the next firm in the visible list when the analyst is still on the passed firm", () => {
    expect(nextAfterPass(["a", "b", "c"], "b", "b")).toBe("c");
    expect(nextAfterPass(["a", "b", "c"], "c", "c")).toBe("a");
  });

  it("leaves an analyst who has moved to another firm where they are", () => {
    expect(nextAfterPass(["a", "b", "c"], "b", "a")).toBeUndefined();
    expect(nextAfterPass(["a", "b", "c"], "b", undefined)).toBeUndefined();
  });

  it("stays put when the passed firm is the only one visible", () => {
    expect(nextAfterPass(["a"], "a", "a")).toBeUndefined();
  });
});
