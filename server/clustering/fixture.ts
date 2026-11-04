/**
 * A recorded Claude clustering reply, replayed by the seed. Pure: no DB, network, or filesystem
 * (`scripts/` reads and writes the file). The fixture applies only to the exact rejections it
 * was recorded for; anything else goes to the fallback clusterer.
 */
import { z } from "zod";
import { hash32 } from "../enrichment/random.js";
import { renderRejections } from "./claude.js";
import type { Clusterer, RejectionRow, RuleProposal } from "./types.js";

export interface ClusteringFixture {
  /** FNV hash of the rendered rejections the proposals were made for. */
  inputHash: string;
  model: string;
  proposals: RuleProposal[];
  createdAt: string;
}

export const hashRejections = (rows: readonly RejectionRow[]): string =>
  hash32(renderRejections(rows)).toString(16).padStart(8, "0");

const fixtureSchema = z.object({
  inputHash: z.string(),
  model: z.string(),
  proposals: z.array(
    z.object({
      predicateAxis: z.string(),
      ruleOperator: z.string(),
      ruleThreshold: z.string(),
      ruleModel: z.enum(["CF", "CS", "both"]),
      summary: z.string(),
      supportingDecisionIds: z.array(z.string()),
    }),
  ),
  createdAt: z.string(),
});

/** The fixture in this JSON text, or null when it is not a valid one. */
export function parseClusteringFixture(text: string): ClusteringFixture | null {
  try {
    const parsed = fixtureSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The fixture's proposals when the rejections are the ones it was recorded for; else the fallback. */
export function fixtureClusterer(
  fixture: ClusteringFixture | null,
  fallback: Clusterer,
): Clusterer {
  return async (rows) =>
    fixture !== null && hashRejections(rows) === fixture.inputHash
      ? { proposals: fixture.proposals, source: "claude" }
      : fallback(rows);
}
