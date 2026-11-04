import { describe, expect, it } from "vitest";
import { PROVIDER_TRUST, axisByName } from "../../shared/vocab.js";
import { observe, truthFor } from "./providers.js";
import type { Observation } from "./providers.js";
import { type FindingPlan, reconcileAxis } from "./reconcile.js";

const firm = { firmId: "acme_unitedstates", firmName: "Acme", firmType: "CF" };
const dealSize = axisByName("deal_size_usd_m")!;
const obs = (provider: Observation["provider"], value: string, confidence = 0.85): Observation => ({
  provider,
  axis: dealSize.axis,
  value,
  confidence,
  sourceUrl: `https://${provider}.example/x`,
  sourceExcerpt: "…",
});

describe("mock providers", () => {
  it("are deterministic per (provider, firm, axis)", () => {
    for (const p of PROVIDER_TRUST) {
      expect(observe(p, firm, dealSize)).toEqual(observe(p, firm, dealSize));
    }
    expect(truthFor(firm, dealSize)).toBe(truthFor(firm, dealSize));
  });

  it("only answer axes they cover, with .example source URLs", () => {
    expect(observe("filings", firm, axisByName("md_pedigree")!)).toBeNull();
    const many = Array.from({ length: 40 }, (_, i) =>
      observe("dealdb", { ...firm, firmId: `f${i}` }, dealSize),
    ).filter(Boolean);
    expect(many.length).toBeGreaterThan(15);
    expect(many.every((o) => o!.sourceUrl.includes(".example/"))).toBe(true);
  });
});

describe("reconcileAxis", () => {
  const ids = () => "cg-1";

  it("keeps document fields from the lead observation", () => {
    const doc = (provider: Observation["provider"], quote: string, model: string): Observation => ({
      ...obs(provider, "60"),
      sourceUrl: "",
      sourceExcerpt: quote,
      sourceDocumentId: `${provider}:acme_unitedstates`,
      sourceQuote: quote,
      model,
    });
    const [plan] = reconcileAxis(
      dealSize,
      [doc("filings", "other quote", "m2"), doc("dealdb", "closes deals near 60 million", "m1")],
      ids,
    );
    expect(plan).toMatchObject<Partial<FindingPlan>>({
      sourceDocumentId: "dealdb:acme_unitedstates",
      sourceQuote: "closes deals near 60 million",
      extractionModel: "m1",
      sourceUrl: null,
    });
  });

  it("uses the grounding excerpt when an abstention follows a rejected answer", () => {
    const [plain] = reconcileAxis(dealSize, [], ids);
    const [rejected] = reconcileAxis(dealSize, [], ids, { groundingRejected: true });
    expect(plain.sourceExcerpt).toBe("No source returned a value for this axis.");
    expect(rejected.sourceExcerpt).toMatch(/was not supported by a quote in the source/);
    expect(rejected.sourceDocumentId).toBeNull();
  });

  it("abstains honestly when no source has the value", () => {
    const [p] = reconcileAxis(dealSize, [], ids);
    expect(p).toMatchObject<Partial<FindingPlan>>({
      value: null,
      findingStatus: "abstained",
      confidenceTier: "abstain",
    });
  });

  it("corroborates agreeing sources into one high-confidence finding", () => {
    const plans = reconcileAxis(dealSize, [obs("filings", "60"), obs("dealdb", "60.0", 0.7)], ids);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      provider: "dealdb+filings",
      confidenceTier: "high",
      conflictGroupId: null,
    });
  });

  it("surfaces a disagreement as a conflict pair ordered by trust", () => {
    const plans = reconcileAxis(dealSize, [obs("websearch", "20", 0.5), obs("dealdb", "60")], ids);
    expect(plans.map((p) => [p.provider, p.value, p.conflictGroupId, p.confidenceTier])).toEqual([
      ["dealdb", "60", "cg-1", "low"],
      ["websearch", "20", "cg-1", "low"],
    ]);
  });

  it("marks a lone low-confidence source as low", () => {
    expect(reconcileAxis(dealSize, [obs("websearch", "20", 0.5)], ids)[0].confidenceTier).toBe(
      "low",
    );
  });
});
