/**
 * Moving the agent paths onto the trait catalog must not change a byte of what Claude is sent or
 * of the mock documents the committed extraction fixtures were recorded against. These digests
 * were taken from the code before that move (plan H, task 5); a change here means a fixture or a
 * prompt version must change too.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLUSTER_SYSTEM, clusterOutputSchema, renderRejections } from "./clustering/claude.js";
import { asFirmObject } from "./eval/pipeline.js";
import { plantRejections } from "./eval/rules.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./extraction/contract.js";
import { documentsHash, firmDocuments } from "./extraction/documents.js";
import { generateUniverse } from "./seed/universe.js";
import { TEST_RUBRIC } from "./testing.js";

const digest = (s: string): string => createHash("sha256").update(s).digest("hex");
const universe = generateUniverse();
const sample = universe.slice(0, 60);

describe("what the agent paths send", () => {
  it("keeps the extraction system prompt", () => {
    expect(digest(SYSTEM_PROMPT)).toBe(
      "261e0fa80634354fcd0bff06b7f3f5fa977b29e42d6881933f888d992d4ca546",
    );
  });

  it("keeps each firm's user message, for both theses", () => {
    const messages = sample
      .map((f) => buildUserMessage(firmDocuments(f), f.firmType === "CS" ? "CS" : "CF"))
      .join("\n---\n");
    expect(digest(messages)).toBe(
      "7a0b11a1db0b146039e4c3ecd41d0c32c1c9a5e1c34f652e29341daf50e6508b",
    );
  });

  it("keeps the mock documents", () => {
    expect(digest(sample.map((f) => documentsHash(firmDocuments(f))).join(","))).toBe(
      "4393e4d4bd6a04bb6d1f10dcff6bd38230417805cf7fd2eaaeff70c08d3358fd",
    );
  });

  it("keeps the clustering prompt and tool", async () => {
    const { rows } = await plantRejections(universe.map(asFirmObject));
    expect(digest(renderRejections(rows))).toBe(
      "f5a1de09961b455dcbaadaecf2158e3e62b67492ea7fcbc2f0a984ca1fe7cea1",
    );
    // Re-pinned once in task 5: the axis enum now follows catalog order (the same seven axes).
    expect(digest(CLUSTER_SYSTEM + JSON.stringify(clusterOutputSchema(TEST_RUBRIC)))).toBe(
      "8856fceec8d17e3d9a9bd85ed6b48273f8c21701d5449b239499f72fb9d51ff4",
    );
  });
});
