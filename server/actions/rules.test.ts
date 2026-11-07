import { describe, expect, it } from "vitest";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer } from "../clustering/types.js";
import type { Db } from "../db/client.js";
import { getObject, insertObject, listAll } from "../db/repo.js";
import { T0, createTestDb, run, seedFirm } from "../testing.js";

async function pendingRule(db: Db, id = "r1") {
  await insertObject(db, "ProposedRule", {
    proposedRuleId: id,
    predicateAxis: "employees",
    ruleOperator: "<",
    ruleThreshold: "10",
    ruleModel: "both",
    ruleStatus: "pending",
    supportingDecisionIds: "[]",
    proposedAt: T0.toISOString(),
  });
  return id;
}

const configs = (db: Db) => listAll(db, "HardScreenConfig", { orderBy: { configVersion: "asc" } });

describe("rule lifecycle", () => {
  it("approve → amend → unapprove keeps one active, versioned config", async () => {
    const db = await createTestDb();
    const id = await pendingRule(db);
    await run(db, "approveRule", { proposedRule: id });
    await expect(run(db, "approveRule", { proposedRule: id })).rejects.toMatchObject({
      status: 409,
    });
    await run(db, "amendRuleThreshold", { proposedRule: id, newThreshold: "8" });
    let rows = await configs(db);
    expect(rows.map((c) => [c.configVersion, c.configThreshold, c.configActive])).toEqual([
      [1, "10", false],
      [2, "8", true],
    ]);
    await run(db, "unapproveRule", { proposedRule: id });
    rows = await configs(db);
    expect(rows.every((c) => c.configActive === false)).toBe(true);
    expect((await getObject(db, "ProposedRule", id))?.ruleStatus).toBe("pending");
  });

  it("dismissal needs a reason and deactivates configs", async () => {
    const db = await createTestDb();
    const id = await pendingRule(db);
    await run(db, "approveRule", { proposedRule: id });
    await expect(run(db, "dismissRule", { proposedRule: id, reason: " " })).rejects.toThrow(
      /reason/,
    );
    await run(db, "dismissRule", { proposedRule: id, reason: "Screens out good seed-stage firms" });
    expect((await getObject(db, "ProposedRule", id))?.ruleStatus).toBe("dismissed");
    expect((await configs(db)).some((c) => c.configActive)).toBe(false);
  });

  it("rejects an invalid amended operator", async () => {
    const db = await createTestDb();
    const id = await pendingRule(db);
    await run(db, "approveRule", { proposedRule: id });
    await expect(
      run(db, "amendRuleThreshold", { proposedRule: id, newThreshold: "8", newOperator: "~" }),
    ).rejects.toThrow(/operator/);
  });
});

describe("clusterRejections", () => {
  async function rejectedSmallFirms(db: Db) {
    for (let i = 0; i < 5; i++) {
      const f = await seedFirm(db, { employees: 4 + i });
      await run(db, "rejectFirm", {
        firm: f.$primaryKey,
        rejectionRationale: `Too small — ${4 + i} staff.`,
      });
    }
    const big = await seedFirm(db, { employees: 50 });
    await run(db, "rejectFirm", {
      firm: big.$primaryKey,
      rejectionRationale: "Too small a franchise for us.",
    });
    for (const employees of [5, 8, 40]) {
      await seedFirm(db, { employees, lifecycleState: "Screening" });
    }
  }

  it("proposes a grounded rule with support and projected impact, once", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const result = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(result.note).toMatch(/heuristic/);
    const [rule] = await listAll(db, "ProposedRule");
    expect(rule).toMatchObject({
      predicateAxis: "employees",
      ruleOperator: "<",
      ruleThreshold: "10",
      ruleStatus: "pending",
    });
    expect(rule.supportingFirmCount).toBe(5); // the 50-person firm does not satisfy the predicate
    expect(JSON.parse(rule.supportingDecisionIds!)).toHaveLength(5);
    expect(rule.projectedScreenCount).toBe(2); // queue firms with 5 and 8 staff
    expect(rule.proposedAt, "stamped with the action clock").toBe(T0.toISOString());
    expect(rule.ruleDecidedAt).toBeUndefined();
    await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(await listAll(db, "ProposedRule")).toHaveLength(1);
  });

  it("a second run adds nothing and says so plainly", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    const before = await listAll(db, "ProposedRule");
    expect(before).toHaveLength(1);

    const again = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(again.created).toEqual([]);
    expect(again.note).toBe(
      "No new patterns since the last run (6 passes checked). Already covered by an existing rule: Headcount below 10 (pending).",
    );
    expect(await listAll(db, "ProposedRule")).toEqual(before);
  });

  /** A clusterer that proposes one predicate, backed by every rejection on file. */
  const proposing =
    (
      predicateAxis: string,
      ruleOperator: string,
      ruleThreshold: string,
      ruleModel: "CF" | "CS" | "both" = "both",
    ): Clusterer =>
    async (rows) => ({
      source: "claude",
      proposals: [
        {
          predicateAxis,
          ruleOperator,
          ruleThreshold,
          ruleModel,
          summary: "x",
          supportingDecisionIds: rows.map((r) => r.decisionId),
        },
      ],
    });

  it("a threshold variant of a pending or active rule is the same pattern, CF-only or for both", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    await run(db, "clusterRejections", {}, { clusterer: proposing("employees", "<", "12", "CF") });
    const [first] = await listAll(db, "ProposedRule");
    expect(first).toMatchObject({ ruleThreshold: "12", ruleModel: "CF" });

    const pending = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(pending.created).toEqual([]);
    expect(pending.note).toContain(
      "Already covered by an existing rule: Headcount below 12 (pending).",
    );

    // Approved and then amended, the rule still covers its pattern.
    await run(db, "approveRule", { proposedRule: first.$primaryKey });
    await run(db, "amendRuleThreshold", { proposedRule: first.$primaryKey, newThreshold: "9" });
    const active = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(active.created).toEqual([]);
    expect(active.note).toContain("Headcount below 12 (active)");
    expect(await listAll(db, "ProposedRule")).toHaveLength(1);
  });

  it("a rule for the other model is a different pattern; a rule for both covers either", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const existing = (proposedRuleId: string, ruleModel: string) =>
      insertObject(db, "ProposedRule", {
        proposedRuleId,
        predicateAxis: "employees",
        ruleOperator: "<",
        ruleThreshold: "20",
        ruleModel,
        ruleStatus: "pending",
        supportingDecisionIds: "[]",
        proposedAt: T0.toISOString(),
      });
    // A CS-only rule screens other firms than a CF-only one does.
    await existing("cs-rule", "CS");
    const cf = await run(
      db,
      "clusterRejections",
      {},
      { clusterer: proposing("employees", "<", "10", "CF") },
    );
    expect(cf.created).toHaveLength(1);
    expect(await listAll(db, "ProposedRule")).toHaveLength(2);

    // A rule for both models already covers a CF-only proposal, and the other way round.
    const other = await createTestDb();
    await rejectedSmallFirms(other);
    await insertObject(other, "ProposedRule", {
      proposedRuleId: "both-rule",
      predicateAxis: "employees",
      ruleOperator: "<",
      ruleThreshold: "20",
      ruleModel: "both",
      ruleStatus: "pending",
      supportingDecisionIds: "[]",
      proposedAt: T0.toISOString(),
    });
    const blocked = await run(
      other,
      "clusterRejections",
      {},
      { clusterer: proposing("employees", "<", "10", "CF") },
    );
    expect(blocked.created).toEqual([]);
    expect(blocked.note).toContain("Headcount below 20 (pending)");
  });

  it("proposes a threshold variant once the rule that had the pattern is dismissed", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    await run(db, "clusterRejections", {}, { clusterer: proposing("employees", "<", "12") });
    const [first] = await listAll(db, "ProposedRule");
    await run(db, "dismissRule", { proposedRule: first.$primaryKey, reason: "Too broad" });

    const result = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(result.created).toHaveLength(1);
    // The dismissed rule itself is never proposed again.
    const repeat = await run(
      db,
      "clusterRejections",
      {},
      { clusterer: proposing("employees", "<", "12") },
    );
    expect(repeat.created).toEqual([]);
    expect(await listAll(db, "ProposedRule")).toHaveLength(2);
  });

  it("one run proposes one rule per pattern", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const twice: Clusterer = async (rows) => ({
      source: "claude",
      proposals: [
        ...(await proposing("employees", "<", "10")(rows)).proposals,
        ...(await proposing("employees", "<", "12")(rows)).proposals,
      ],
    });
    const result = await run(db, "clusterRejections", {}, { clusterer: twice });
    expect(result.created).toHaveLength(1);
    expect(result.note).toContain(
      "Already covered by an existing rule: Headcount below 10 (pending).",
    );
  });

  it("does not propose a rule the rubric already enforces", async () => {
    const db = await createTestDb();
    for (let i = 0; i < 4; i++) {
      const f = await seedFirm(db, { coverageModel: "Generalist" });
      await run(db, "rejectFirm", {
        firm: f.$primaryKey,
        rejectionRationale: "Generalist coverage with no sector depth.",
      });
    }
    for (const model of ["CF", "both"] as const) {
      const result = await run(
        db,
        "clusterRejections",
        {},
        { clusterer: proposing("coverage_model", "==", "Generalist", model) },
      );
      expect(result.created).toEqual([]);
      expect(result.note).toBe(
        "No new patterns since the last run (4 passes checked). Already enforced by the rubric: Sector coverage is Generalist.",
      );
    }
    expect(await listAll(db, "ProposedRule")).toHaveLength(0);
  });

  it("says when no pattern has enough support", async () => {
    const db = await createTestDb();
    const f = await seedFirm(db, { employees: 4 });
    await run(db, "rejectFirm", { firm: f.$primaryKey, rejectionRationale: "Too small." });
    const result = await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(result.note).toBe("No pattern has enough support yet (1 pass checked).");
  });

  it("calls the clusterer outside the transaction", async () => {
    const real = await createTestDb();
    await rejectedSmallFirms(real);
    let inTx = false;
    const db: Db = {
      ...real,
      async transaction(fn) {
        inTx = true;
        try {
          return await real.transaction(fn);
        } finally {
          inTx = false;
        }
      },
    };
    const seen: boolean[] = [];
    const spy: Clusterer = async (rows) => {
      seen.push(inTx);
      return heuristicClusterer(rows);
    };
    await run(db, "clusterRejections", {}, { clusterer: spy });
    expect(seen).toEqual([false]);
    expect(await listAll(real, "ProposedRule")).toHaveLength(1);
  });

  it("does not duplicate a proposal another run committed while the clusterer was working", async () => {
    const real = await createTestDb();
    await rejectedSmallFirms(real);
    const racing: Clusterer = async (rows) => {
      const out = await heuristicClusterer(rows);
      // A concurrent request lands the same rule before this run's transaction opens.
      await run(real, "clusterRejections", {}, { clusterer: heuristicClusterer });
      return out;
    };
    await run(real, "clusterRejections", {}, { clusterer: racing });
    expect(await listAll(real, "ProposedRule")).toHaveLength(1);
  });

  it("takes the proposing lock before it reads the rules on file", async () => {
    const real = await createTestDb();
    await rejectedSmallFirms(real);
    const statements: string[] = [];
    const db: Db = {
      ...real,
      async transaction(fn) {
        return real.transaction((tx) =>
          fn({
            ...tx,
            query: (sql, params) => {
              statements.push(sql);
              return tx.query(sql, params);
            },
          }),
        );
      },
    };
    await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    const lock = statements.findIndex((q) => q.includes("pg_advisory_xact_lock"));
    const read = statements.findIndex((q) => q.includes("proposed_rule"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(read);
  });

  it("drops proposals with bad axes, bad operators, or too little real support", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const decisions = await listAll(db, "ReviewDecision", {
      where: { decisionType: { $eq: "reject" } },
    });
    const ids = decisions.map((d) => d.$primaryKey);
    const fake: Clusterer = async () => ({
      source: "claude",
      proposals: [
        {
          predicateAxis: "vibes",
          ruleOperator: "<",
          ruleThreshold: "1",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
        {
          predicateAxis: "employees",
          ruleOperator: "~",
          ruleThreshold: "10",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
        {
          predicateAxis: "employees",
          ruleOperator: "<",
          ruleThreshold: "10",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids.slice(0, 3),
        },
        {
          predicateAxis: "employees",
          ruleOperator: ">",
          ruleThreshold: "100",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
      ],
    });
    await run(db, "clusterRejections", {}, { clusterer: fake });
    expect(await listAll(db, "ProposedRule")).toHaveLength(0);
  });

  it("counts distinct firms, not decisions", async () => {
    const db = await createTestDb();
    const firms = [];
    for (let i = 0; i < 3; i++) {
      const f = await seedFirm(db, { employees: 4 + i });
      await run(db, "rejectFirm", { firm: f.$primaryKey, rejectionRationale: "Too small." });
      firms.push(f);
    }
    // The same firm rejected a second time (e.g. after a re-engage).
    await insertObject(db, "ReviewDecision", {
      decisionId: "d-again",
      firmId: firms[0].$primaryKey,
      decisionType: "reject",
      rejectionRationale: "Still too small.",
      decidedAt: new Date().toISOString(),
    });
    const ids = (
      await listAll(db, "ReviewDecision", { where: { decisionType: { $eq: "reject" } } })
    ).map((d) => d.$primaryKey);
    expect(ids).toHaveLength(4);
    const fake: Clusterer = async () => ({
      source: "claude",
      proposals: [
        {
          predicateAxis: "employees",
          ruleOperator: "<",
          ruleThreshold: "10",
          ruleModel: "both",
          summary: "x",
          supportingDecisionIds: ids,
        },
      ],
    });
    await run(db, "clusterRejections", {}, { clusterer: fake });
    expect(await listAll(db, "ProposedRule")).toHaveLength(0);
  });
});
