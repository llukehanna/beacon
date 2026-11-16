import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evidenceTraits } from "../../shared/rubric/catalog.js";
import { PROVIDER_TRUST } from "../../shared/vocab.js";
import { ADVISORY_ACQUISITIONS } from "../../shared/workspaces/advisoryAcquisitions.js";
import { observe, truthFor } from "../enrichment/providers.js";
import { TEST_RUBRIC } from "../testing.js";
import { generateUniverse } from "./universe.js";

const AXES = evidenceTraits(TEST_RUBRIC.traits);
/** Trait key → the firm column it had (the first alias; the second S&T spelling was a parameter). */
const COLUMN_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ADVISORY_ACQUISITIONS.legacyFieldAliases)
    .reverse()
    .map(([column, key]) => [key, column]),
);

/**
 * Every generated firm, by its place in the universe, with everything about it except its name and
 * the id made from the name: its profile, the hidden true value of each axis, and what each
 * provider reports (value and confidence, or nothing). Renaming firms must leave this unchanged.
 */
function groundTruthLines(): string[] {
  return generateUniverse().map((firm, i) => {
    // Spelled as the firm was before traits moved out of columns, so the hash still compares.
    const { traits, thesis, ...rest } = firm;
    const profile: Record<string, unknown> = {
      ...rest,
      firmType: thesis,
      ...Object.fromEntries(Object.entries(traits).map(([k, v]) => [COLUMN_OF[k], v])),
    };
    delete profile.firmId;
    delete profile.firmName;
    const truth = AXES.map((a) => `${a.traitKey}=${truthFor(firm, a)}`);
    const reports = PROVIDER_TRUST.flatMap((p) =>
      AXES.map((a) => {
        const o = observe(p, firm, a);
        return `${p}.${a.traitKey}=${o ? `${o.value}@${o.confidence}` : "-"}`;
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
