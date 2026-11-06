import { describe, expect, it } from "vitest";
import { fuzzyScore, rankCommands } from "./fuzzy";

describe("fuzzyScore", () => {
  it("scores initials on word starts above a scattered match", () => {
    const initials = fuzzyScore("bt", "Bellhaven Talbot Group");
    const scattered = fuzzyScore("bt", "Abbott Partners");
    expect(initials).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(initials as number).toBeGreaterThan(scattered as number);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "Beacon")).toBeNull();
    expect(fuzzyScore("nocab", "Beacon")).toBeNull();
  });

  it("ignores case and spaces in the query", () => {
    expect(fuzzyScore("BELL tal", "Bellhaven Talbot Group")).not.toBeNull();
  });

  it("rewards a contiguous run over the same letters spread out", () => {
    expect(fuzzyScore("ru", "Rules") as number).toBeGreaterThan(
      fuzzyScore("ru", "Rapidly curt") as number,
    );
  });

  it("prefers the shorter name when the match is otherwise the same", () => {
    const short = fuzzyScore("ainsley advis", "Ainsley Advisors") as number;
    const long = fuzzyScore("ainsley advis", "Ainsley & Carrow Advisory") as number;
    expect(short).toBeGreaterThan(long);
  });

  it("matches everything, with a neutral score, when the query is empty", () => {
    expect(fuzzyScore("", "Anything")).toBe(0);
    expect(fuzzyScore("   ", "Anything")).toBe(0);
  });
});

describe("rankCommands", () => {
  it("puts the closer match first and drops non-matches", () => {
    const ranked = rankCommands("ru", [{ label: "Review" }, { label: "Rules" }]);
    expect(ranked.map((r) => r.label)).toEqual(["Rules"]);
    expect(ranked[0]?.label).toBe("Rules");
  });

  it("returns the first eight in original order for an empty query", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ label: `Item ${i}` }));
    expect(rankCommands("", items)).toEqual(items.slice(0, 8));
  });

  it("keeps original order for equal scores and honours the limit", () => {
    const items = [{ label: "Alpha 1" }, { label: "Alpha 2" }, { label: "Alpha 3" }];
    expect(rankCommands("alpha", items, 2).map((r) => r.label)).toEqual(["Alpha 1", "Alpha 2"]);
  });
});
