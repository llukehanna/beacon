import { beforeAll, describe, expect, it } from "vitest";
import {
  type ScreenableFirm,
  countScreened,
  isEvaluable,
  toScreeningRules,
} from "../../shared/activeScreening.js";
import { buildActivity } from "../../shared/activityFeed.js";
import { needsYouAxisCountByFirm } from "../../shared/axisState.js";
import {
  type MembershipLike,
  type SearchLike,
  type SearchListLike,
  mandateFirmCounts,
  searchListFirmIds,
} from "../../shared/mandateFirms.js";
import { OPEN_BUCKETS, bucketOf, emptyBucketCounts } from "../../shared/pipelineBuckets.js";
import {
  QUEUE_FIELDS,
  SCORE_INPUT_FIELDS,
  firmFieldNames,
  orderEnrichmentQueue,
  toQueueFirm,
} from "../../shared/queue.js";
import { summarizePredicate } from "../../shared/rulePredicate.js";
import { OBJECT_TYPES, type ObjectOf } from "../../shared/schema.js";
import { mirrorScore } from "../../shared/scoreMirror.js";
import type { AccuracySummary, HomeSummary, ShellCounts } from "../../shared/summaries.js";
import { findingTrends, groundedCounts } from "../../shared/trends.js";
import {
  type FirmOutcomeLike,
  accuracyTables,
  cellsFromFindings,
  rates,
  tallyOutcomes,
} from "../../shared/trustMetrics.js";
import { type Db } from "../db/client.js";
import { insertObjects, listAll, listLinked } from "../db/repo.js";
import { type SourceDocument, sourceDocument } from "../extraction/documents.js";
import { resetDemo } from "../seed/reset.js";
import { createTestDb } from "../testing.js";
import { findingCells } from "./findings.js";
import {
  VISIBLE_ROWS,
  feedRules,
  homeSummary,
  loadLeanFirms,
  needsYouAxes,
  pendingRules,
  projectRule,
} from "./homeSummary.js";
import { runFunction } from "./index.js";

let db: Db;

/** A CF firm in Screening that the base rules leave alone. */
const BASE = {
  firmType: "CF",
  coverageModel: "Single-sector focus",
  geoScore: 2,
  lifecycleState: "Screening",
  currentStage: "Screening",
};

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
    // Analyst-authored: verified without verifiedByHuman, still an agreement.
    f("edge_analyst", { provider: "analyst", findingStatus: "verified" }, "13"),
    // Only the analyst's own value is credited by status; another provider's is merely pending.
    f("edge_other_verified", { provider: "dealdb", findingStatus: "verified" }, "14"),
    // A synthetic market signal's finding is news, not a reading of a source: no trust figure counts it.
    f("edge_market_signal", { provider: "market_signal", findingStatus: "signal" }, "15"),
    // A newer market signal does not settle an axis the agent abstained on: it still needs the analyst.
    f("edge_signal_over_abstained", { confidenceTier: "abstain" }, "16"),
    f(
      "edge_signal_over_abstained",
      {
        provider: "market_signal",
        findingStatus: "signal",
        confidenceTier: undefined,
        retrievedAt: "2026-09-10T00:00:00.000Z",
      },
      "17",
    ),
  ]);
}, 600_000);

const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** Inbox rows without their `at` (the client reference does not carry times). */
const withoutAt = <T extends { at: string | null }>(items: readonly T[]) =>
  items.map(({ at: _at, ...rest }) => rest);
const runPendingRules = () => pendingRules(db);

const withIds = (rows: ObjectOf<"ResearchFinding">[]) =>
  rows.map((r) => ({ ...r, findingId: r.$primaryKey }));

/** Rows as the UI holds them: wire objects whose finding ids are spelled `findingId`. */
type Plain = Record<string, unknown>;

/** Home.tsx's own client-side computation (rows from the API, the UI's shared helpers), on `d`. */
async function clientHome(d: Db) {
  const firms = await listAll(d, "Firm", { orderBy: { firmName: "asc" } });
  const configs = (await listAll(d, "HardScreenConfig"))
    .filter((r) => r.configActive === true)
    .map((r) => ({
      ruleId: r.configRuleId!,
      axis: r.configAxis ?? "",
      operator: r.configOperator ?? "",
      threshold: r.configThreshold ?? "",
      model: r.configModel ?? "both",
    }))
    .filter((r) => r.axis !== "" && r.operator !== "" && r.threshold !== "");
  const drifts = (await listAll(d, "DriftEvent", { orderBy: { detectedAt: "desc" } })).filter(
    (x) => (x.driftStatus ?? "").toLowerCase() !== "resolved",
  );
  const rules = (await listAll(d, "ProposedRule")).filter(
    (r) => (r.ruleStatus ?? "pending").toLowerCase() === "pending",
  );
  const findings = await listAll(d, "ResearchFinding");

  const firmNameById = new Map(firms.map((x) => [x.firmId!, x.firmName ?? x.firmId!]));
  const workable = orderEnrichmentQueue(firms.map(toQueueFirm), configs).filter(
    (r) => !r.hardScreened && !r.terminal,
  );
  const axes = needsYouAxisCountByFirm(withIds(findings));
  const judgment = workable.filter((r) => (axes.get(r.firm.firmId) ?? 0) > 0);
  const screens = (r: Plain): number | null => {
    const [screen] = toScreeningRules(
      [{ ...r, proposedRuleId: r.proposedRuleId as string, ruleStatus: "approved" }],
      [],
    );
    return screen === undefined || !isEvaluable(screen)
      ? null
      : countScreened(firms as ScreenableFirm[], [screen]);
  };
  const items: Plain[] = [
    ...drifts.map((x) => {
      const reason = (x.driftReason ?? "").toLowerCase();
      return {
        kind: "drift",
        key: `drift:${x.driftEventId}`,
        rank: reason === "outcome_diverged" ? 0 : reason === "pass_reason_invalidated" ? 1 : 2,
        destination: "review",
        firmId: x.firmId,
        name: firmNameById.get(x.firmId ?? "") ?? x.firmId ?? "Unknown firm",
        driftReason: x.driftReason,
        priorTier: x.priorTier,
        priorScore: x.priorScore,
        newTier: x.newTier,
        newScore: x.newScore,
      };
    }),
    ...judgment.map((r) => ({
      kind: "judgment",
      key: `firm:${r.firm.firmId}`,
      rank: 3,
      destination: "desk",
      firmId: r.firm.firmId,
      name: r.firm.firmName ?? r.firm.firmId,
      axes: axes.get(r.firm.firmId),
    })),
    ...rules.map((r) => ({
      kind: "rule",
      key: `rule:${r.proposedRuleId}`,
      rank: 4,
      destination: "rules",
      proposedRuleId: r.proposedRuleId,
      name:
        summarizePredicate(r.predicateAxis, r.ruleOperator, r.ruleThreshold) ??
        "malformed proposal",
      screens: screens(r),
    })),
  ].sort((x, y) => x.rank - y.rank);

  const funnel = emptyBucketCounts();
  for (const x of firms) {
    funnel[bucketOf(x, mirrorScore(x))] += 1;
  }

  const overall = rates(withIds(findings));
  const outcomes = tallyOutcomes(firms as FirmOutcomeLike[]);

  const searches = await listAll(d, "Search");
  const lists = await listAll(d, "SearchList");
  const linked = await listLinked(
    d,
    "SearchList",
    "firms",
    lists.map((l) => l.searchId!),
  );
  const counts = mandateFirmCounts({
    searches: searches as SearchLike[],
    memberships: (await listAll(d, "SearchMembership")) as MembershipLike[],
    firms,
    searchLists: lists as SearchListLike[],
    searchListFirmIds: searchListFirmIds(new Map(Object.entries(linked))),
  });
  const mandates = (await listAll(d, "Mandate", { orderBy: { createdAt: "desc" } })).filter(
    (m) => m.active !== false,
  );
  return { firms, rules, items, funnel, overall, outcomes, counts, mandates, screens };
}

describe("homeSummary", () => {
  let summary: HomeSummary;
  let client: Awaited<ReturnType<typeof clientHome>>;
  beforeAll(async () => {
    [summary, client] = await Promise.all([homeSummary(db), clientHome(db)]);
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

  it("gives the shell the same counts Home shows, from its own lean query", async () => {
    const counts = (await runFunction(db, "shellCounts")) as ShellCounts;
    expect(counts).toEqual({
      open: OPEN_BUCKETS.reduce((sum, bucket) => sum + summary.funnel[bucket], 0),
      review: summary.needsYouCounts.review,
      activeMandates: summary.mandates.length,
    });
    // Not vacuous: a hard-rejected firm still reads "Discovered" in its lifecycleState, so
    // counting that column alone would overshoot the funnel's open count.
    const byColumn = client.firms.filter((f) =>
      ["Discovered", "Screening"].includes(f.lifecycleState ?? ""),
    ).length;
    expect(counts.open).toBeGreaterThan(0);
    expect(counts.open).toBeLessThan(byColumn);
    expect(counts.review).toBeGreaterThan(0);
    expect(counts.activeMandates).toBeGreaterThan(0);
  });

  it("includes trends, activity and headline", async () => {
    expect(summary.activity.length).toBeGreaterThanOrEqual(1);
    expect(summary.activity.length).toBeLessThanOrEqual(7);
    for (const item of summary.activity) {
      expect(new Date(item.at).toISOString(), item.title).toBe(item.at);
    }
    const times = summary.activity.map((i) => Date.parse(i.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    expect(summary.headline).not.toBeNull();
    expect(summary.headline!.enrichedFirms).toBeGreaterThan(0);
    expect(summary.headline!.windowHours).toBe(24);

    // The query hands the pure module the same columns the objects carry: nothing is lost on
    // the way. A series the seeded history cannot support is null, never an invented line.
    const findings = await listAll(db, "ResearchFinding");
    expect(summary.trends).toEqual(findingTrends(withIds(findings)));
    expect(summary.grounded).toEqual(groundedCounts(withIds(findings)));
    expect(summary.grounded.agentValues).toBeGreaterThan(0);
    expect(summary.grounded.cited).toBeLessThanOrEqual(summary.grounded.agentValues);
    for (const trend of Object.values(summary.trends)) {
      if (trend !== null) {
        expect(trend.points.length).toBeGreaterThanOrEqual(4);
        for (const p of trend.points) {
          expect(p.value).toBeGreaterThanOrEqual(0);
          expect(p.value).toBeLessThanOrEqual(100);
          expect(p.n).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it("feeds proposed rules into the activity feed with their recorded time", async () => {
    const rows = await db.query<{ proposedRuleId: string; proposedAt: Date | string | null }>(
      `SELECT "proposedRuleId", "proposedAt" FROM proposed_rule WHERE lower(coalesce("ruleStatus", 'pending')) = 'pending'`,
    );
    expect(rows.length).toBeGreaterThan(1);
    // The seeded rules were proposed by the real action, so each carries a time.
    for (const r of rows) {
      expect(r.proposedAt, r.proposedRuleId).not.toBeNull();
    }
    // Every pending rule is fed in: the full feed has one rule_proposed item per rule, dated by proposedAt.
    const full = buildActivity(
      { firms: [], findings: [], proposedRules: feedRules(await runPendingRules()) },
      1000,
    );
    const proposed = full.filter((i) => i.kind === "rule_proposed");
    expect(proposed.map((i) => i.at).sort()).toEqual(
      rows.map((r) => new Date(r.proposedAt!).toISOString()).sort(),
    );
    for (const item of proposed) {
      expect(new Date(item.at).toISOString()).toBe(item.at);
      expect(item.title).toMatch(/^Rule proposed: \S+ \S+ \S+/);
      expect(item.detail).toMatch(/^Supported by \d+ firms?$/);
    }
  });

  it("dates the rows that have a time and leaves the others undated", () => {
    for (const item of summary.needsYou) {
      if (item.kind === "rule") {
        expect(item.at, item.key).toBeNull();
      } else if (item.at !== null) {
        expect(new Date(item.at).toISOString(), item.key).toBe(item.at);
      }
    }
    const dated = summary.needsYou.filter((i) => i.kind !== "rule" && i.at !== null);
    expect(dated.length).toBeGreaterThan(0);
  });

  it("lists the same inbox rows, with the same content, in the same order", () => {
    expect(summary.needsYouTotal).toBe(client.items.length);
    expect(summary.needsYou.length).toBe(Math.min(VISIBLE_ROWS, client.items.length));
    // Whole rows, as they cross the wire: name, axes, drift tiers and scores, screens.
    expect(wire(withoutAt(summary.needsYou))).toEqual(wire(client.items.slice(0, VISIBLE_ROWS)));
    for (const dest of ["review", "desk", "rules"] as const) {
      expect(summary.needsYouCounts[dest], dest).toBe(
        client.items.filter((i) => i.destination === dest).length,
      );
    }
  });

  it("projects every pending rule like the client, whether or not it is on screen", async () => {
    const pending = await runPendingRules();
    expect(pending.length).toBeGreaterThan(1);
    const firms = await loadLeanFirms(db);
    const projected = pending.map((r) => projectRule(r, firms));
    expect(projected).toEqual(pending.map((r) => client.screens(r as unknown as Plain)));
    // Not vacuous: some rules are evaluable, some are not.
    expect(projected.some((n) => n !== null)).toBe(true);
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
    // The edge-case firm gets exactly the axes that should abstain: edge_abstained, edge_tie,
    // edge_status_abstained and edge_signal_over_abstained (superseded, conflict-grouped,
    // verified-first and latest-wins do not).
    const edgeFirm = (
      await listAll(db, "ResearchFinding", { where: { findingId: { $eq: "edge-1" } } })
    )[0].firmId!;
    const others = (
      await listAll(db, "ResearchFinding", { where: { firmId: { $eq: edgeFirm } } })
    ).filter((x) => !x.findingId!.startsWith("edge-"));
    const seededAxes = needsYouAxisCountByFirm(withIds(others)).get(edgeFirm) ?? 0;
    expect(sql.get(edgeFirm)).toBe(seededAxes + 4);
  });

  it("selects every Firm column the rules and the score can read, and only real ones", () => {
    const columns = new Set(QUEUE_FIELDS);
    for (const field of firmFieldNames()) {
      expect(columns.has(field), field).toBe(true);
    }
    for (const column of QUEUE_FIELDS) {
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
    // The analyst-verified edge finding is an agreement on both sides.
    const analyst = sql.find((c) => c.axis === "edge_analyst");
    expect(analyst).toMatchObject({ provider: "analyst", agree: 1, override: 0, total: 1 });
    expect(sql.find((c) => c.axis === "edge_other_verified")).toMatchObject({ agree: 0 });
    // Market-signal findings exist in the world, and neither side counts them.
    const stored = await listAll(db, "ResearchFinding", {
      where: { provider: { $eq: "market_signal" } },
    });
    expect(stored.length).toBeGreaterThan(1);
    expect(sql.some((c) => c.provider === "market_signal")).toBe(false);
    expect(js.some((c) => c.provider === "market_signal")).toBe(false);
  });

  it("reports the agent's abstentions as 'No source' rather than a provider row", async () => {
    const summary = (await runFunction(db, "accuracySummary")) as AccuracySummary;
    const keys = summary.byProvider.map((r) => r.key);
    expect(keys).not.toContain("agent");
    expect(keys).not.toContain("analyst");
    expect(keys.at(-1)).toBe("__none__");
    expect(summary.byProvider.at(-1)!.r.abstention).toBe(100);
  });
});

describe("sourceDocument", () => {
  it("returns the firm's document and 404s on unknown ids", async () => {
    const [firm] = await listAll(db, "Firm", { where: { lifecycleState: { $eq: "Screening" } } });
    const doc = (await runFunction(db, "sourceDocument", {
      firmId: firm.$primaryKey,
      provider: "dealdb",
    })) as SourceDocument;
    expect(doc).toEqual(sourceDocument("dealdb", firm));
    expect(doc.documentId).toBe(`dealdb:${firm.$primaryKey}`);
    expect(doc.body).toContain(firm.firmName);

    const unknownFirm = runFunction(db, "sourceDocument", {
      firmId: "no-such-firm",
      provider: "dealdb",
    });
    await expect(unknownFirm).rejects.toMatchObject({ status: 404 });
    const unknownProvider = runFunction(db, "sourceDocument", {
      firmId: firm.$primaryKey,
      provider: "nope",
    });
    await expect(unknownProvider).rejects.toMatchObject({ status: 404 });
    await expect(runFunction(db, "sourceDocument", {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("runFunction", () => {
  it("404s an unknown function, including inherited names", async () => {
    await expect(runFunction(db, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(runFunction(db, "constructor")).rejects.toMatchObject({ status: 404 });
    await expect(runFunction(db, "toString")).rejects.toMatchObject({ status: 404 });
  });
});

describe("homeSummary on a small world where rule rows are on screen", () => {
  it("shows drift and rule rows with the content Home renders", async () => {
    const d = await createTestDb();
    await insertObjects(d, "Firm", [
      { firmId: "a", firmName: "Alpha", employees: 5, ...BASE },
      { firmId: "b", firmName: "Beta", employees: 50, ...BASE },
      { firmId: "c", firmName: "Gamma", employees: 8, ...BASE },
    ]);
    await insertObjects(d, "DriftEvent", [
      {
        driftEventId: "d1",
        firmId: "a",
        driftReason: "outcome_diverged",
        driftStatus: "open",
        detectedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        driftEventId: "d2",
        firmId: "b",
        driftReason: "tier_moved",
        driftStatus: "open",
        priorTier: "A",
        priorScore: 16,
        newTier: "B",
        newScore: 13,
        detectedAt: "2026-09-03T00:00:00.000Z",
      },
      { driftEventId: "d3", firmId: "c", driftReason: "tier_moved", driftStatus: "resolved" },
    ]);
    await insertObjects(d, "ProposedRule", [
      { proposedRuleId: "r1", predicateAxis: "employees", ruleOperator: "<", ruleThreshold: "10" },
      {
        proposedRuleId: "r2",
        predicateAxis: "coverage_model",
        ruleOperator: "in",
        ruleThreshold: '["x"]',
        ruleStatus: "pending",
      },
      { proposedRuleId: "r3" }, // malformed: no predicate
      {
        proposedRuleId: "r4",
        predicateAxis: "employees",
        ruleOperator: "<",
        ruleThreshold: "99",
        ruleStatus: "approved",
      },
    ]);
    const [summary, client] = await Promise.all([homeSummary(d), clientHome(d)]);

    expect(summary.needsYou.filter((i) => i.kind === "rule")).toHaveLength(3);
    expect(summary.needsYouTotal).toBe(5);
    expect(wire(withoutAt(summary.needsYou))).toEqual(wire(client.items));
    // Pinned by hand, not just against the client: r1 screens Alpha and Gamma, the text and
    // malformed predicates are "not computed", and the approved rule is not an inbox row.
    expect(
      summary.needsYou.map((i) => [i.key, i.name, i.kind === "rule" ? i.screens : undefined]),
    ).toEqual([
      ["drift:d1", "Alpha", undefined],
      ["drift:d2", "Beta", undefined],
      ["rule:r1", "employees < 10", 2],
      ["rule:r2", 'coverage_model in "["x"]"', null],
      ["rule:r3", "malformed proposal", null],
    ]);
    expect(summary.needsYou[1]).toMatchObject({
      priorTier: "A",
      priorScore: 16,
      newTier: "B",
      newScore: 13,
    });
  });
});

describe("homeSummary and a hard-screen rule on a gate axis", () => {
  it("screens the same firms as the UI's queue input", async () => {
    const d = await createTestDb();
    await insertObjects(d, "Firm", [
      { firmId: "insolvent", firmName: "Insolvent", solvent: false, ...BASE },
      { firmId: "sound", firmName: "Sound", solvent: true, ...BASE },
    ]);
    await insertObjects(
      d,
      "ResearchFinding",
      ["insolvent", "sound"].map((firmId) => ({
        findingId: `f-${firmId}`,
        firmId,
        axis: "firm_age",
        confidenceTier: "abstain",
        findingStatus: "abstained",
      })),
    );
    await insertObjects(d, "HardScreenConfig", [
      {
        configRuleId: "c1",
        configAxis: "solvent",
        configOperator: "==",
        configThreshold: "false",
        configModel: "both",
        configActive: true,
      },
    ]);
    const configs = [
      { ruleId: "c1", axis: "solvent", operator: "==", threshold: "false", model: "both" },
    ];
    const firms = await listAll(d, "Firm");

    // The helper the UI ranks with screens the insolvent firm...
    const ranked = orderEnrichmentQueue(firms.map(toQueueFirm), configs);
    expect(ranked.find((r) => r.firm.firmId === "insolvent")?.hardScreened).toBe(true);
    expect(ranked.find((r) => r.firm.firmId === "sound")?.hardScreened).toBe(false);
    // ...which the score-inputs-only input it replaced could not see.
    const scoreOnly = firms.map((f) => ({
      firmId: f.firmId!,
      ...Object.fromEntries(SCORE_INPUT_FIELDS.map((k) => [k, (f as Plain)[k]])),
    }));
    expect(orderEnrichmentQueue(scoreOnly, configs).some((r) => r.hardScreened)).toBe(false);

    // And the summary agrees with it.
    const summary = await homeSummary(d);
    expect(summary.needsYou.map((i) => i.key)).toEqual(["firm:sound"]);
    expect((await clientHome(d)).items.map((i) => i.key)).toEqual(["firm:sound"]);
  });
});
