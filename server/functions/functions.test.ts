import { beforeAll, describe, expect, it } from "vitest";
import {
  type ScreenableFirm,
  countScreened,
  isEvaluable,
  toScreeningRules,
} from "../../shared/activeScreening.js";
import { needsYouAxisCountByFirm } from "../../shared/axisState.js";
import {
  type MembershipLike,
  type SearchLike,
  type SearchListLike,
  mandateFirmCounts,
  searchListFirmIds,
} from "../../shared/mandateFirms.js";
import { bucketOf, emptyBucketCounts } from "../../shared/pipelineBuckets.js";
import { firmFieldNames, orderEnrichmentQueue } from "../../shared/queue.js";
import { OBJECT_TYPES, type ObjectOf } from "../../shared/schema.js";
import { mirrorScore } from "../../shared/scoreMirror.js";
import type { AccuracySummary, HomeSummary } from "../../shared/summaries.js";
import {
  type FirmOutcomeLike,
  accuracyTables,
  cellsFromFindings,
  rates,
  tallyOutcomes,
} from "../../shared/trustMetrics.js";
import { type Db } from "../db/client.js";
import { insertObjects, listAll, listLinked } from "../db/repo.js";
import { resetDemo } from "../seed/reset.js";
import { createTestDb } from "../testing.js";
import { findingCells } from "./findings.js";
import { FIRM_COLUMNS, VISIBLE_ROWS, homeSummary, needsYouAxes } from "./homeSummary.js";
import { runFunction } from "./index.js";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await resetDemo(db, new Date("2026-09-22T12:00:00.000Z"));
  // Findings the seed does not produce, to pin the "authoritative finding" edge cases on a firm
  // that has no other findings on these axes: each axis name below is its own group.
  const [firm] = await listAll(db, "Firm", { where: { lifecycleState: { $eq: "Screening" } } });
  const f = (axis: string, patch: Record<string, unknown>, id: string) => ({
    findingId: `edge-${id}`,
    firmId: firm.$primaryKey,
    axis,
    confidenceTier: "high",
    findingStatus: "proposed",
    retrievedAt: "2026-09-01T00:00:00.000Z",
    ...patch,
  });
  await insertObjects(db, "ResearchFinding", [
    // Abstained, then superseded: invisible.
    f("edge_superseded", { confidenceTier: "abstain", findingStatus: "superseded" }, "1"),
    // Abstained inside a conflict group: a conflict card, not an axis card.
    f("edge_conflict", { confidenceTier: "abstain", conflictGroupId: "cg1" }, "2"),
    // A verified finding beats a newer abstained one.
    f("edge_verified", { verifiedByHuman: true, findingStatus: "verified" }, "3"),
    f("edge_verified", { confidenceTier: "abstain", retrievedAt: "2026-09-10T00:00:00.000Z" }, "4"),
    // Latest wins when nothing is verified: abstained older, proposed newer.
    f("edge_latest", { confidenceTier: "abstain" }, "5"),
    f("edge_latest", { retrievedAt: "2026-09-10T00:00:00.000Z" }, "6"),
    // Abstained is the latest: counts.
    f("edge_abstained", {}, "7"),
    f(
      "edge_abstained",
      { confidenceTier: "abstain", retrievedAt: "2026-09-10T00:00:00.000Z" },
      "8",
    ),
    // Same instant: the first by id wins on both sides.
    f("edge_tie", { confidenceTier: "abstain" }, "09"),
    f("edge_tie", {}, "10"),
    // findingStatus alone marks an abstention; a rejected one is an override.
    f("edge_status_abstained", { findingStatus: "abstained" }, "11"),
    f("edge_rejected", { findingStatus: "rejected" }, "12"),
  ]);
}, 600_000);

const withIds = (rows: ObjectOf<"ResearchFinding">[]) =>
  rows.map((r) => ({ ...r, findingId: r.$primaryKey }));

/** Home.tsx's own client-side computation, on the same rows. */
async function clientHome() {
  const firms = await listAll(db, "Firm", { orderBy: { firmName: "asc" } });
  const configs = (await listAll(db, "HardScreenConfig"))
    .filter((r) => r.configActive === true)
    .map((r) => ({
      ruleId: r.configRuleId!,
      axis: r.configAxis ?? "",
      operator: r.configOperator ?? "",
      threshold: r.configThreshold ?? "",
      model: r.configModel ?? "both",
    }))
    .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "");
  const drifts = (await listAll(db, "DriftEvent", { orderBy: { detectedAt: "desc" } })).filter(
    (d) => (d.driftStatus ?? "").toLowerCase() !== "resolved",
  );
  const rules = (await listAll(db, "ProposedRule")).filter(
    (r) => (r.ruleStatus ?? "pending").toLowerCase() === "pending",
  );
  const findings = await listAll(db, "ResearchFinding");

  const queueFirms = firms.map((x) => ({ ...x, firmId: x.firmId ?? "" }));
  const workable = orderEnrichmentQueue(queueFirms, configs).filter(
    (r) => !r.hardScreened && !r.terminal,
  );
  const axes = needsYouAxisCountByFirm(withIds(findings));
  const judgment = workable.filter((r) => (axes.get(r.firm.firmId) ?? 0) > 0);
  const items = [
    ...drifts.map((d) => {
      const reason = (d.driftReason ?? "").toLowerCase();
      return {
        key: `drift:${d.driftEventId}`,
        rank: reason === "outcome_diverged" ? 0 : reason === "pass_reason_invalidated" ? 1 : 2,
        destination: "review",
      };
    }),
    ...judgment.map((r) => ({ key: `firm:${r.firm.firmId}`, rank: 3, destination: "desk" })),
    ...rules.map((r) => ({ key: `rule:${r.proposedRuleId}`, rank: 4, destination: "rules" })),
  ].sort((a, b) => a.rank - b.rank);

  const funnel = emptyBucketCounts();
  for (const x of firms) {
    funnel[bucketOf(x, mirrorScore(x))] += 1;
  }

  const overall = rates(withIds(findings));
  const outcomes = tallyOutcomes(firms as FirmOutcomeLike[]);

  const searches = await listAll(db, "Search");
  const lists = await listAll(db, "SearchList");
  const linked = await listLinked(
    db,
    "SearchList",
    "firms",
    lists.map((l) => l.searchId!),
  );
  const counts = mandateFirmCounts({
    searches: searches as SearchLike[],
    memberships: (await listAll(db, "SearchMembership")) as MembershipLike[],
    firms,
    searchLists: lists as SearchListLike[],
    searchListFirmIds: searchListFirmIds(new Map(Object.entries(linked))),
  });
  const mandates = (await listAll(db, "Mandate", { orderBy: { createdAt: "desc" } })).filter(
    (m) => m.active !== false,
  );
  return { firms, rules, items, funnel, overall, outcomes, counts, mandates };
}

describe("homeSummary", () => {
  let summary: HomeSummary;
  let client: Awaited<ReturnType<typeof clientHome>>;
  beforeAll(async () => {
    [summary, client] = await Promise.all([homeSummary(db), clientHome()]);
  }, 600_000);

  it("is not a vacuous comparison", () => {
    // The seeded world has something in every part of Home.
    expect(client.items.some((i) => i.destination === "review")).toBe(true);
    expect(client.items.some((i) => i.destination === "desk")).toBe(true);
    expect(client.items.some((i) => i.destination === "rules")).toBe(true);
    expect(client.mandates.length).toBeGreaterThan(0);
    expect(client.counts.size).toBeGreaterThan(0);
    expect(client.overall.decided).toBeGreaterThan(0);
    expect(client.outcomes.passed).toBeGreaterThan(0);
  });

  it("counts the funnel like the client", () => {
    expect(summary.funnel).toEqual(client.funnel);
    expect(Object.values(summary.funnel).reduce((a, b) => a + b, 0)).toBe(client.firms.length);
  });

  it("lists the same inbox rows in the same order", () => {
    expect(summary.needsYouTotal).toBe(client.items.length);
    expect(summary.needsYou.length).toBe(Math.min(VISIBLE_ROWS, client.items.length));
    expect(summary.needsYou.map((i) => i.key)).toEqual(
      client.items.slice(0, VISIBLE_ROWS).map((i) => i.key),
    );
    for (const dest of ["review", "desk", "rules"] as const) {
      expect(summary.needsYouCounts[dest], dest).toBe(
        client.items.filter((i) => i.destination === dest).length,
      );
    }
  });

  it("projects each visible rule like the client", () => {
    const visible = summary.needsYou.filter((i) => i.kind === "rule");
    for (const item of visible) {
      const rule = client.rules.find((r) => r.proposedRuleId === item.proposedRuleId)!;
      const [screen] = toScreeningRules(
        [{ ...rule, proposedRuleId: rule.proposedRuleId!, ruleStatus: "approved" }],
        [],
      );
      const expected =
        screen === undefined || !isEvaluable(screen)
          ? null
          : countScreened(client.firms as ScreenableFirm[], [screen]);
      expect(item.screens, item.key).toBe(expected);
    }
  });

  it("matches the client's trust numbers and outcomes", () => {
    expect(summary.trust).toEqual({
      abstentionRate: client.overall.abstention,
      agreementRate: client.overall.agreement,
      decidedFindings: client.overall.decided,
      outcomes: client.outcomes.counts,
      passed: client.outcomes.passed,
      passedAndAcquired: client.outcomes.passedAndAcquired,
    });
  });

  it("counts mandate scope like mandateFirmCounts", () => {
    expect(summary.mandates.map((m) => m.mandateId)).toEqual(
      client.mandates.map((m) => m.mandateId),
    );
    for (const m of summary.mandates) {
      expect({ scoped: m.scoped, fromSearches: m.fromSearches }, m.mandateId).toEqual(
        client.counts.get(m.mandateId) ?? { scoped: 0, fromSearches: 0 },
      );
    }
  });

  it("finds the same abstained axes as needsYouAxisCountByFirm, edge cases included", async () => {
    const sql = await needsYouAxes(db);
    const reference = needsYouAxisCountByFirm(withIds(await listAll(db, "ResearchFinding")));
    expect(Object.fromEntries(sql)).toEqual(Object.fromEntries(reference));
    // The edge-case firm gets exactly the axes that should abstain: edge_abstained, edge_tie and
    // edge_status_abstained (superseded, conflict-grouped, verified-first and latest-wins do not).
    const edgeFirm = (
      await listAll(db, "ResearchFinding", { where: { findingId: { $eq: "edge-1" } } })
    )[0].firmId!;
    const others = (
      await listAll(db, "ResearchFinding", { where: { firmId: { $eq: edgeFirm } } })
    ).filter((x) => !x.findingId!.startsWith("edge-"));
    const seededAxes = needsYouAxisCountByFirm(withIds(others)).get(edgeFirm) ?? 0;
    expect(sql.get(edgeFirm)).toBe(seededAxes + 3);
  });

  it("selects every Firm column the rules and the score can read, and only real ones", () => {
    const columns = new Set(FIRM_COLUMNS);
    for (const field of firmFieldNames()) {
      expect(columns.has(field), field).toBe(true);
    }
    for (const column of FIRM_COLUMNS) {
      expect(Object.keys(OBJECT_TYPES.Firm.properties), column).toContain(column);
    }
  });
});

describe("accuracySummary", () => {
  it("matches the client-side tables built from the same rows", async () => {
    const summary = (await runFunction(db, "accuracySummary")) as AccuracySummary;
    const findings = withIds(await listAll(db, "ResearchFinding"));
    const firms = await listAll(db, "Firm");
    const expected = accuracyTables(cellsFromFindings(findings));
    expect(summary.overall).toEqual(rates(findings));
    expect(summary.byProvider).toEqual(expected.byProvider);
    expect(summary.byAxis).toEqual(expected.byAxis);
    expect(summary.byProvider.length).toBeGreaterThan(1);
    expect(summary.byAxis.length).toBeGreaterThan(3);
    expect(summary.byAxis.some((a) => a.key === "edge_rejected")).toBe(true);
    expect(summary.outcomes).toEqual(tallyOutcomes(firms as FirmOutcomeLike[]));
  });

  it("classifies findings in SQL exactly as classify does", async () => {
    const byKey = (c: { provider: string; axis: string }) => `${c.provider}\u0000${c.axis}`;
    const sql = [...(await findingCells(db))].sort((a, b) => byKey(a).localeCompare(byKey(b)));
    const js = cellsFromFindings(withIds(await listAll(db, "ResearchFinding"))).sort((a, b) =>
      byKey(a).localeCompare(byKey(b)),
    );
    expect(sql).toEqual(js);
  });
});

describe("runFunction", () => {
  it("404s an unknown function, including inherited names", async () => {
    await expect(runFunction(db, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(runFunction(db, "constructor")).rejects.toMatchObject({ status: 404 });
    await expect(runFunction(db, "toString")).rejects.toMatchObject({ status: 404 });
  });
});
