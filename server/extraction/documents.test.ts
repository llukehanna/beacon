import { describe, expect, it } from "vitest";
import { ENRICH_AXES, PROVIDER_TRUST } from "../../shared/vocab.js";
import { confidenceFor, observe } from "../enrichment/providers.js";
import { generateUniverse } from "../seed/universe.js";
import { DOCUMENT_VERSION, documentsHash, firmDocuments, sourceDocument } from "./documents.js";

const firms = generateUniverse(50);
const firm = firms[0];

describe("sourceDocument", () => {
  it("is deterministic", () => {
    for (const f of firms.slice(0, 10)) {
      for (const p of PROVIDER_TRUST) {
        expect(sourceDocument(p, f)).toEqual(sourceDocument(p, f));
      }
    }
  });

  it("carries identity, a visible mock label, and one document per provider in trust order", () => {
    const docs = firmDocuments(firm);
    expect(docs.map((d) => d.provider)).toEqual([...PROVIDER_TRUST]);
    for (const d of docs) {
      expect(d.documentId).toBe(`${d.provider}:${firm.firmId}`);
      expect(d.firmId).toBe(firm.firmId);
      expect(d.body).toContain("Mock source");
      expect(d.body).toContain(firm.firmName);
    }
  });

  it("puts every field sentence verbatim in the body, with its value inside", () => {
    for (const f of firms) {
      for (const d of firmDocuments(f)) {
        for (const field of d.fields) {
          expect(d.body).toContain(field.sentence);
          expect(field.sentence).toContain(field.value);
        }
      }
    }
  });

  it("states exactly the non-null observe() results for that provider", () => {
    for (const f of firms) {
      for (const p of PROVIDER_TRUST) {
        const expected = ENRICH_AXES.flatMap((a) => {
          const o = observe(p, f, a);
          return o ? [{ axis: a.axis, value: o.value }] : [];
        });
        const got = sourceDocument(p, f).fields.map(({ axis, value }) => ({ axis, value }));
        expect(got).toEqual(expected);
      }
    }
  });

  it("contains no snake_case axis ids in any body", () => {
    for (const f of firms) {
      for (const d of firmDocuments(f)) {
        expect(d.body).not.toMatch(/[a-z]+_[a-z_]+/);
      }
    }
  });

  it("says so when a provider has no detail on the firm", () => {
    const empty = firms.flatMap((f) => firmDocuments(f)).filter((d) => d.fields.length === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const d of empty) {
      expect(d.body).toMatch(/no detail/);
    }
  });

  it("hashes the body", () => {
    const [a, b] = [sourceDocument("dealdb", firms[0]), sourceDocument("dealdb", firms[1])];
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("documentsHash", () => {
  it("is stable and changes when a body changes by one character", () => {
    const docs = firmDocuments(firm);
    expect(documentsHash(docs)).toBe(documentsHash(firmDocuments(firm)));
    const edited = docs.map((d, i) => (i === 1 ? { ...d, body: `${d.body}.` } : d));
    expect(documentsHash(edited)).not.toBe(documentsHash(docs));
  });

  it("is pinned to the document version", () => {
    expect(DOCUMENT_VERSION).toBe("doc-v1");
  });
});

describe("confidenceFor", () => {
  it("matches the confidence observe assigns, and falls back to the midpoint", () => {
    let seen = 0;
    let missed = 0;
    for (const f of firms) {
      for (const p of PROVIDER_TRUST) {
        for (const a of ENRICH_AXES) {
          const o = observe(p, f, a);
          const c = confidenceFor(p, f, a);
          if (o) {
            expect(c).toBe(o.confidence);
            seen++;
          } else {
            expect(c).toBeGreaterThan(0.39);
            expect(c).toBeLessThan(0.98);
            expect(c).toBe(Math.round(c * 100) / 100);
            missed++;
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(missed).toBeGreaterThan(0);
    // Websearch midpoint is (0.4 + 0.75) / 2 = 0.575, rounded to 2 decimals.
    const miss = ENRICH_AXES.find((a) => !observe("websearch", firm, a))!;
    expect(confidenceFor("websearch", firm, miss)).toBe(0.58);
  });
});
