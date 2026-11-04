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
  });
});
