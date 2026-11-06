import { describe, expect, it } from "vitest";
import { ENRICH_AXES } from "../../shared/vocab.js";
import { observe } from "../enrichment/providers.js";
import { generateUniverse } from "../seed/universe.js";
import {
  RULE_BASED_MODEL,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseExtraction,
  ruleBasedExtraction,
} from "./contract.js";
import { type SourceDocument, firmDocuments } from "./documents.js";
import { groundExtraction } from "./grounding.js";

const firms = generateUniverse(50);

const field = (docs: SourceDocument[], provider: string, axis: string) => {
  const doc = docs.find((d) => d.provider === provider)!;
  return { doc, field: doc.fields.find((f) => f.axis === axis) };
};

/** The first firm whose dealdb document states the given axis. */
function firmWith(axis: string) {
  for (const firm of firms) {
    const docs = firmDocuments(firm);
    const { field: f } = field(docs, "dealdb", axis);
    if (f) {
      return { firm, docs, f };
    }
  }
  throw new Error(`no firm with ${axis}`);
}

describe("rule-based extraction", () => {
  it("grounds every field", () => {
    for (const firm of firms) {
      const docs = firmDocuments(firm);
      const result = groundExtraction(firm, docs, ruleBasedExtraction(docs), RULE_BASED_MODEL);
      expect(result.rejected).toEqual([]);
      const got = result.observations.map((o) => `${o.provider}|${o.axis}|${o.value}`).sort();
      const expected = docs
        .flatMap((d) =>
          ENRICH_AXES.flatMap((a) => {
            const o = observe(d.provider, firm, a);
            return o ? [`${o.provider}|${o.axis}|${o.value}`] : [];
          }),
        )
        .sort();
      expect(got).toEqual(expected);
      for (const o of result.observations) {
        expect(o.sourceUrl).toBe("");
        expect(o.sourceDocumentId).toBe(`${o.provider}:${firm.firmId}`);
        expect(o.sourceExcerpt).toBe(o.sourceQuote);
        expect(o.model).toBe(RULE_BASED_MODEL);
      }
    }
  });
});

describe("groundExtraction", () => {
  it("rejects a quote altered by one character", () => {
    const { firm, docs, f } = firmWith("firm_age");
    const quote = f.sentence.replace("The", "Tha");
    const out = {
      items: [{ provider: "dealdb" as const, axis: "firm_age", value: f.value, quote }],
    };
    const r = groundExtraction(firm, docs, out, "m");
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { provider: "dealdb", axis: "firm_age", reason: "quote_not_in_document" },
    ]);
  });

  it("collapses whitespace runs on both sides before comparing", () => {
    const { firm, docs, f } = firmWith("firm_age");
    const quote = `  ${f.sentence.replace(/ /g, "  \n ")} `;
    const r = groundExtraction(
      firm,
      docs,
      { items: [{ provider: "dealdb", axis: "firm_age", value: f.value, quote }] },
      "m",
    );
    expect(r.rejected).toEqual([]);
    expect(r.observations).toHaveLength(1);
  });

  it("rejects a real quote that does not contain the value", () => {
    for (const firm of firms) {
      const docs = firmDocuments(firm);
      const dealdb = docs.find((d) => d.provider === "dealdb")!;
      const size = dealdb.fields.find((x) => x.axis === "deal_size_usd_m");
      const other = dealdb.fields.find(
        (x) => x.axis === "fee_generating_count" && x.value !== size?.value,
      );
      if (!size || !other) {
        continue;
      }
      const r = groundExtraction(
        firm,
        docs,
        {
          items: [
            {
              provider: "dealdb",
              axis: "deal_size_usd_m",
              value: size.value,
              quote: other.sentence,
            },
          ],
        },
        "m",
      );
      expect(r.observations).toEqual([]);
      expect(r.rejected).toEqual([
        { provider: "dealdb", axis: "deal_size_usd_m", reason: "value_not_in_quote" },
      ]);
      return;
    }
    throw new Error("no suitable firm");
  });

  describe("gate values", () => {
    /** A firm whose filings record states two gates, one recorded true and one recorded false. */
    function firmWithTrueAndFalseGates() {
      for (const firm of generateUniverse(300)) {
        const docs = firmDocuments(firm);
        const gates = docs
          .find((d) => d.provider === "filings")!
          .fields.filter((f) =>
            ["advisory_conflict", "solvent", "has_st_or_balance_sheet"].includes(f.axis),
          );
        const yes = gates.find((f) => f.value === "true");
        const no = gates.find((f) => f.value === "false");
        if (yes && no) {
          return { firm, docs, yes, no };
        }
      }
      throw new Error("no firm with a true and a false gate");
    }
    const ask = (
      { firm, docs }: { firm: (typeof firms)[number]; docs: SourceDocument[] },
      axis: string,
      value: string,
      quote: string,
    ) =>
      groundExtraction(firm, docs, { items: [{ provider: "filings", axis, value, quote }] }, "m");

    it("keeps a gate answer quoted from the axis's own record sentence", () => {
      const w = firmWithTrueAndFalseGates();
      for (const f of [w.yes, w.no]) {
        const r = ask(w, f.axis, f.value, f.sentence);
        expect(r.rejected).toEqual([]);
        expect(r.observations.map((o) => o.value)).toEqual([f.value]);
      }
    });

    it("rejects a true answer whose real quote does not say true", () => {
      const w = firmWithTrueAndFalseGates();
      const r = ask(w, w.yes.axis, "true", w.no.sentence);
      expect(r.observations).toEqual([]);
      expect(r.rejected).toEqual([
        { provider: "filings", axis: w.yes.axis, reason: "value_not_in_quote" },
      ]);
    });

    it("rejects a false answer whose quote says only true", () => {
      const w = firmWithTrueAndFalseGates();
      const r = ask(w, w.no.axis, "false", w.yes.sentence);
      expect(r.observations).toEqual([]);
      expect(r.rejected).toEqual([
        { provider: "filings", axis: w.no.axis, reason: "value_not_in_quote" },
      ]);
    });

    it("matches the value as a whole word", () => {
      const w = firmWithTrueAndFalseGates();
      const sentence = "The filing was untrue about the firm's solvency in earlier years.";
      const patched = w.docs.map((d) =>
        d.provider === "filings" ? { ...d, body: `${d.body}\n${sentence}` } : d,
      );
      const r = ask({ firm: w.firm, docs: patched }, "solvent", "true", sentence);
      expect(r.rejected).toEqual([
        { provider: "filings", axis: "solvent", reason: "value_not_in_quote" },
      ]);
    });
  });

  it("compares numbers by token, not substring", () => {
    const { firm, docs } = firmWith("deal_size_usd_m");
    const sentence = "A typical transaction is sized at about $85 million.";
    const patched = docs.map((d) =>
      d.provider === "dealdb" ? { ...d, body: `${d.body}\n${sentence}` } : d,
    );
    const ask = (value: string) =>
      groundExtraction(
        firm,
        patched,
        { items: [{ provider: "dealdb", axis: "deal_size_usd_m", value, quote: sentence }] },
        "m",
      );
    expect(ask("5").rejected).toEqual([
      { provider: "dealdb", axis: "deal_size_usd_m", reason: "value_not_in_quote" },
    ]);
    expect(ask("8").rejected).toHaveLength(1);
    expect(ask("85").rejected).toEqual([]);
    expect(ask("85.0").observations).toHaveLength(1);
  });

  it("rejects a label outside the vocabulary", () => {
    for (const firm of firms) {
      const docs = firmDocuments(firm);
      const { field: f } = field(docs, "beacondb", "services_fit");
      if (!f) {
        continue;
      }
      const r = groundExtraction(
        firm,
        docs,
        {
          items: [
            { provider: "beacondb", axis: "services_fit", value: "Excellent", quote: f.sentence },
          ],
        },
        "m",
      );
      expect(r.observations).toEqual([]);
      expect(r.rejected).toEqual([
        { provider: "beacondb", axis: "services_fit", reason: "invalid_value" },
      ]);
      return;
    }
    throw new Error("no suitable firm");
  });

  it("rejects a label from the other firm model's list", () => {
    const cs = firms.find((f) => f.firmType === "CS");
    const cf = firms.find((f) => f.firmType !== "CS");
    expect(cs && cf).toBeTruthy();
    const check = (firm: (typeof firms)[number], label: string) => {
      const docs = firmDocuments(firm);
      return groundExtraction(
        firm,
        docs,
        { items: [{ provider: "beacondb", axis: "services_fit", value: label, quote: label }] },
        "m",
      );
    };
    expect(check(cs!, "Full advisory suite").rejected[0]?.reason).toBe("invalid_value");
    expect(check(cf!, "Full private-capital suite").rejected[0]?.reason).toBe("invalid_value");
  });

  it("rejects an axis the provider does not cover", () => {
    const firm = firms[0];
    const docs = firmDocuments(firm);
    const r = groundExtraction(
      firm,
      docs,
      { items: [{ provider: "beacondb", axis: "solvent", value: "true", quote: "solvent true" }] },
      "m",
    );
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { provider: "beacondb", axis: "solvent", reason: "axis_not_covered" },
    ]);
  });

  it("ignores null values", () => {
    const firm = firms[0];
    const r = groundExtraction(
      firm,
      firmDocuments(firm),
      {
        items: [
          { provider: "dealdb", axis: "firm_age", value: null, quote: null },
          { provider: "beacondb", axis: "solvent", value: null, quote: "anything" },
        ],
      },
      "m",
    );
    expect(r).toEqual({ observations: [], rejected: [] });
  });

  it("rejects a value with no quote", () => {
    const { firm, docs, f } = firmWith("firm_age");
    const r = groundExtraction(
      firm,
      docs,
      { items: [{ provider: "dealdb", axis: "firm_age", value: f.value, quote: null }] },
      "m",
    );
    expect(r.rejected[0]?.reason).toBe("quote_not_in_document");
  });
});

/** The documents with extra text appended to one provider's body. */
const withLine = (docs: SourceDocument[], provider: string, line: string): SourceDocument[] =>
  docs.map((d) => (d.provider === provider ? { ...d, body: `${d.body}\n${line}` } : d));

describe("groundExtraction: tightened checks", () => {
  it("rejects a real sentence that lacks the label, and accepts the label in any case", () => {
    const firm = firms.find((f) => field(firmDocuments(f), "beacondb", "services_fit").field)!;
    const docs = firmDocuments(firm);
    const { doc, field: f } = field(docs, "beacondb", "services_fit");
    const ask = (d: SourceDocument[], quote: string) =>
      groundExtraction(
        firm,
        d,
        { items: [{ provider: "beacondb", axis: "services_fit", value: f!.value, quote }] },
        "m",
      );

    const filler = doc.body.split("\n")[1];
    expect(ask(docs, filler).rejected).toEqual([
      { provider: "beacondb", axis: "services_fit", reason: "value_not_in_quote" },
    ]);

    const shouted = `Its service offering is assessed as: ${f!.value.toUpperCase()}.`;
    const r = ask(withLine(docs, "beacondb", shouted), shouted);
    expect(r.rejected).toEqual([]);
    expect(r.observations.map((o) => o.value)).toEqual([f!.value]);
  });

  it("accepts a quote that spans two body lines, and stores the raw slice", () => {
    for (const firm of firms) {
      const docs = firmDocuments(firm);
      const doc = docs.find((d) => d.fields.length >= 2);
      if (!doc) {
        continue;
      }
      const [a, b] = doc.fields;
      const r = groundExtraction(
        firm,
        docs,
        {
          items: [
            {
              provider: doc.provider,
              axis: a.axis,
              value: a.value,
              quote: `${a.sentence} ${b.sentence}`,
            },
          ],
        },
        "m",
      );
      expect(r.rejected).toEqual([]);
      const o = r.observations[0];
      expect(o.sourceQuote).toBe(`${a.sentence}\n${b.sentence}`);
      expect(o.sourceExcerpt).toBe(o.sourceQuote);
      expect(doc.body.includes(o.sourceQuote!)).toBe(true);
      return;
    }
    throw new Error("no suitable firm");
  });

  it("stores the raw slice even when the model adds surrounding whitespace", () => {
    const { firm, docs, f } = firmWith("firm_age");
    const r = groundExtraction(
      firm,
      docs,
      {
        items: [
          { provider: "dealdb", axis: "firm_age", value: f.value, quote: `\n ${f.sentence} \t` },
        ],
      },
      "m",
    );
    expect(r.observations[0].sourceQuote).toBe(f.sentence);
  });

  it("ignores numbers glued to letters", () => {
    const { firm, docs } = firmWith("firm_age");
    const sentence = "The firm was founded in Q3 of 2019 after a long search.";
    const patched = withLine(docs, "dealdb", sentence);
    const ask = (value: string) =>
      groundExtraction(
        firm,
        patched,
        { items: [{ provider: "dealdb", axis: "firm_age", value, quote: sentence }] },
        "m",
      );
    expect(ask("3").rejected).toEqual([
      { provider: "dealdb", axis: "firm_age", reason: "value_not_in_quote" },
    ]);
    expect(ask("2019").rejected).toEqual([]);
    expect(ask("2019").observations).toHaveLength(1);
  });

  it("does not read part of a thousands-separated number", () => {
    const { firm, docs } = firmWith("deal_size_usd_m");
    const sentence = "A typical transaction is sized at about $1,200 million.";
    const patched = withLine(docs, "dealdb", sentence);
    for (const value of ["1", "200", "1200"]) {
      const r = groundExtraction(
        firm,
        patched,
        { items: [{ provider: "dealdb", axis: "deal_size_usd_m", value, quote: sentence }] },
        "m",
      );
      expect(r.rejected).toEqual([
        { provider: "dealdb", axis: "deal_size_usd_m", reason: "value_not_in_quote" },
      ]);
    }
  });

  it("reads a number before a comma but not glued or partial numbers", () => {
    const { firm, docs } = firmWith("deal_size_usd_m");
    const cases: [string, string, boolean][] = [
      ["In 2019, the firm advised on deals of $60 million.", "60", true],
      ["Deals were sized at 60, with most below that level.", "60", true],
      ["Leverage ran at 12x on the larger transactions.", "12", false],
      ["Fees ran near .5 million on the smaller transactions.", "5", false],
      ["The deal book was version 3.5.1 of the internal model.", "3.5", false],
    ];
    for (const [sentence, value, accepted] of cases) {
      const patched = withLine(docs, "dealdb", sentence);
      const r = groundExtraction(
        firm,
        patched,
        { items: [{ provider: "dealdb", axis: "deal_size_usd_m", value, quote: sentence }] },
        "m",
      );
      expect(r.observations.length === 1, `${sentence} / ${value}`).toBe(accepted);
    }
  });

  it("requires number values to be plain digits", () => {
    const { firm, docs, f } = firmWith("firm_age");
    for (const value of ["1e1", "1,200", "12 years", "0x10", "-3", ".5"]) {
      const r = groundExtraction(
        firm,
        docs,
        { items: [{ provider: "dealdb", axis: "firm_age", value, quote: f.sentence }] },
        "m",
      );
      expect(r.rejected).toEqual([
        { provider: "dealdb", axis: "firm_age", reason: "invalid_value" },
      ]);
    }
  });

  it("rejects a fragment quote as too short, after checking the document", () => {
    const { firm, docs, f } = firmWith("firm_age");
    const ask = (quote: string) =>
      groundExtraction(
        firm,
        docs,
        { items: [{ provider: "dealdb", axis: "firm_age", value: f.value, quote }] },
        "m",
      );
    expect(ask(f.value).rejected).toEqual([
      { provider: "dealdb", axis: "firm_age", reason: "quote_too_short" },
    ]);
    expect(ask("zzz qqq").rejected[0].reason).toBe("quote_not_in_document");
  });

  it("keeps the first of two accepted items for the same provider and axis", () => {
    const { firm, docs, f } = firmWith("firm_age");
    const item = {
      provider: "dealdb" as const,
      axis: "firm_age",
      value: f.value,
      quote: f.sentence,
    };
    const r = groundExtraction(firm, docs, { items: [item, item] }, "m");
    expect(r.observations).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });
});

describe("parseExtraction", () => {
  const reply = {
    items: [{ provider: "dealdb", axis: "firm_age", value: "12", quote: "Twelve." }],
  };

  it("handles fences, garbage, and unknown items", () => {
    expect(parseExtraction(JSON.stringify(reply))).toEqual(reply);
    expect(parseExtraction("```json\n" + JSON.stringify(reply) + "\n```")).toEqual(reply);
    expect(parseExtraction("not json")).toBeNull();
    expect(parseExtraction('{"nope":1}')).toBeNull();
    const mixed = {
      items: [
        ...reply.items,
        { provider: "bloomberg", axis: "firm_age", value: "3", quote: "x" },
        { provider: "dealdb", axis: "vibes", value: "3", quote: "x" },
        "junk",
      ],
    };
    expect(parseExtraction(JSON.stringify(mixed))).toEqual(reply);
  });

  it("coerces numeric values and keeps nulls", () => {
    const out = parseExtraction(
      '{"items":[{"provider":"dealdb","axis":"firm_age","value":12,"quote":null}]}',
    );
    expect(out?.items).toEqual([
      { provider: "dealdb", axis: "firm_age", value: "12", quote: null },
    ]);
  });
});

describe("prompt", () => {
  it("names every axis and label list, and fences each document", () => {
    for (const a of ENRICH_AXES) {
      expect(SYSTEM_PROMPT).toContain(a.axis);
    }
    expect(SYSTEM_PROMPT).toContain("Full advisory suite");
    expect(SYSTEM_PROMPT).toContain("Advisory only");
    const docs = firmDocuments(firms[0]);
    const msg = buildUserMessage(docs);
    for (const d of docs) {
      expect(msg).toContain(`<document provider="${d.provider}">`);
      expect(msg).toContain(d.body);
    }
    expect(msg).not.toContain("Firm model");
  });

  it("puts the firm model first when known, and leaves the system prompt static", () => {
    const docs = firmDocuments(firms[0]);
    expect(buildUserMessage(docs, "CF").startsWith("Firm model: CF\n")).toBe(true);
    expect(buildUserMessage(docs, "CS").startsWith("Firm model: CS\n")).toBe(true);
    expect(SYSTEM_PROMPT).toContain("CF firms:");
    expect(SYSTEM_PROMPT).toContain("CS firms:");
    for (const f of firms) {
      expect(SYSTEM_PROMPT).not.toContain(f.firmName);
    }
  });
});
