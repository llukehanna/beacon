import { describe, expect, it } from "vitest";
import { SEED_MANDATES } from "../server/seed/history.js";
import { interpretMandate, searchVocabulary } from "./interpretMandate.js";
import { ALL_SECTORS, COUNTRY_GEO, PRODUCT_GROUPS, REGIONS } from "./taxonomy.js";

const vocabulary = searchVocabulary();
const read = (text: string) => interpretMandate(text, vocabulary);

describe("interpretMandate", () => {
  it("reads each seeded mandate into filters that exist", () => {
    const options: Record<string, Set<string>> = {};
    for (const { facet, groups } of vocabulary.facets) {
      options[facet] = new Set(groups.flatMap((g) => [g.label, ...g.subs]));
    }
    const counts = SEED_MANDATES.map((m) => {
      const { matches } = read(m.title);
      for (const match of matches) {
        expect(options[match.facet]?.has(match.value), `${match.facet}: ${match.value}`).toBe(true);
        expect(m.title.toLowerCase()).toContain(match.phrase.toLowerCase());
      }
      return matches.length;
    });
    expect(counts.every((n) => n >= 1)).toBe(true);
    expect(counts.filter((n) => n >= 2).length).toBeGreaterThanOrEqual(2);
  });

  it("maps the seeded sentences to the filters a reader would pick", () => {
    expect(read(SEED_MANDATES[0].title).matches).toEqual([
      { phrase: "Sector-focused", facet: "products", value: "Sector-focused M&A" },
      { phrase: "sell-side M&A", facet: "products", value: "Sell-side M&A" },
      { phrase: "North America", facet: "geographies", value: "Americas" },
    ]);
    expect(read(SEED_MANDATES[2].title).matches).toEqual([
      { phrase: "Private credit advisory", facet: "products", value: "Private credit advisory" },
    ]);
  });

  it("returns no matches for unrelated text", () => {
    expect(read("quarterly offsite planning")).toEqual({ matches: [], unmatched: [] });
    expect(read("")).toEqual({ matches: [], unmatched: [] });
  });

  it("prefers the longest phrase", () => {
    // "M&A" alone would pick Corporate Finance; the sub-option is the longer, truer reading.
    expect(read("sell-side M&A").matches).toEqual([
      { phrase: "sell-side M&A", facet: "products", value: "Sell-side M&A" },
    ]);
    // "credit" alone is Capital Solutions; the named service line wins over it.
    expect(read("private credit advisory").matches.map((m) => m.value)).toEqual([
      "Private credit advisory",
    ]);
    expect(read("Energy & Industrials").matches.map((m) => m.value)).toEqual([
      "Energy & Industrials",
    ]);
  });

  it("reads a region and flags the size word no filter holds", () => {
    const out = read("European mid-market");
    expect(out.matches).toEqual([{ phrase: "European", facet: "geographies", value: "Europe" }]);
    expect(out.unmatched).toEqual(["mid-market"]);
  });

  it("is insensitive to case, punctuation and hyphenation", () => {
    for (const text of [
      "SELL-SIDE M&A, EUROPE!",
      "sell side m&a (europe)",
      "Sell–side M&A; Europe.",
    ]) {
      expect(
        read(text)
          .matches.map((m) => m.value)
          .sort(),
      ).toEqual(["Europe", "Sell-side M&A"]);
    }
  });

  it("matches whole words only", () => {
    expect(read("Indiana banking in the Netherlandsish style").matches.map((m) => m.value)).toEqual(
      ["Banking"],
    );
    expect(read("creditworthy").matches).toEqual([]);
  });

  it("uses each phrase once and each filter once", () => {
    const out = read("Europe, Europe and European firms");
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].phrase).toBe("Europe");
  });

  it("only ever returns values from the vocabulary", () => {
    const everything = [
      ...REGIONS.flatMap((g) => [g.label, ...g.subs]),
      ...PRODUCT_GROUPS.flatMap((g) => [g.label, ...g.subs]),
      ...ALL_SECTORS,
      ...Object.keys(COUNTRY_GEO),
      "usa uk uae apac saas credit tech",
    ].join(" ; ");
    const known = new Set(
      vocabulary.facets.flatMap(({ groups }) => groups.flatMap((g) => [g.label, ...g.subs])),
    );
    for (const m of read(everything).matches) {
      expect(known.has(m.value)).toBe(true);
    }
  });
});
