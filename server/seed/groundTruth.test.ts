import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ENRICH_AXES, PROVIDER_TRUST } from "../../shared/vocab.js";
import { observe, truthFor } from "../enrichment/providers.js";
import { generateUniverse } from "./universe.js";

/**
 * Every generated firm, by its place in the universe, with everything about it except its name and
 * the id made from the name: its profile, the hidden true value of each axis, and what each
 * provider reports (value and confidence, or nothing). Renaming firms must leave this unchanged.
 */
function groundTruthLines(): string[] {
  return generateUniverse().map((firm, i) => {
    const profile: Record<string, unknown> = { ...firm };
    delete profile.firmId;
    delete profile.firmName;
    const truth = ENRICH_AXES.map((a) => `${a.axis}=${truthFor(firm, a)}`);
    const reports = PROVIDER_TRUST.flatMap((p) =>
      ENRICH_AXES.map((a) => {
        const o = observe(p, firm, a);
        return `${p}.${a.axis}=${o ? `${o.value}@${o.confidence}` : "-"}`;
      }),
    );
    const fields = Object.entries(profile)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${String(v)}`);
    return [i, ...fields, ...truth, ...reports].join("|");
  });
}

describe("ground truth", () => {
  it("is the same per firm as before the firms were renamed", () => {
    const hash = createHash("sha256").update(groundTruthLines().join("\n")).digest("hex");
    // Computed on origin/main at ea792e3, before Plan I changed the names and the documents.
    expect(hash).toBe("16e2a61028b00d9f02cdec6dee64c088e6795c4679b1046ad184709c7e052549");
  });
});
