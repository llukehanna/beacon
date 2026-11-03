import { describe, expect, it } from "vitest";
import type { Queryable } from "../db/client.js";
import { insertObject, insertObjects, updateObject } from "../db/repo.js";
import { statementWrites, writeLog } from "./writes.js";

describe("write tracking", () => {
  // Attribution reads the SQL text, so a stub connection is enough: no database needed.
  const stub: Queryable = { query: async () => [{}] as never };
  async function tracked(fn: (tx: Queryable) => Promise<void>) {
    const log = writeLog();
    await fn(log.track(stub));
    return log.types();
  }

  it("attributes each repository write path to its object type", async () => {
    expect(await tracked((tx) => insertObject(tx, "Firm", { firmId: "f1" }))).toEqual(["Firm"]);
    expect(
      await tracked((tx) => insertObjects(tx, "ReviewDecision", [{ decisionId: "d1" }])),
    ).toEqual(["ReviewDecision"]);
    expect(
      await tracked(async (tx) => {
        await insertObject(tx, "ProposedRule", { proposedRuleId: "r1" });
        await updateObject(tx, "ProposedRule", "r1", { ruleStatus: "approved" });
      }),
    ).toEqual(["ProposedRule"]);
  });

  it("counts a join-table write as a write to the link's source type", async () => {
    expect(
      await tracked(async (tx) => {
        await tx.query(`INSERT INTO search_list_firm ("searchId", "firmId") VALUES ('L1', 'f1')`);
      }),
    ).toEqual(["SearchList"]);
    expect(
      await tracked((tx) => insertObjects(tx, "SearchMembership", [{ membershipId: "m1" }])),
    ).toEqual(["Search", "SearchMembership"]);
  });

  it("attributes raw updates and deletes", async () => {
    expect(
      await tracked(async (tx) => {
        await tx.query(
          `UPDATE hard_screen_config SET "configActive" = false WHERE "configRuleId" = $1`,
          ["c1"],
        );
      }),
    ).toEqual(["HardScreenConfig"]);
    expect(
      await tracked(async (tx) => {
        await tx.query(`DELETE FROM drift_event WHERE "driftEventId" = $1`, ["x"]);
      }),
    ).toEqual(["DriftEvent"]);
  });

  it("ignores reads, locks and non-object tables", async () => {
    expect(
      await tracked(async (tx) => {
        await tx.query(`SELECT * FROM firm WHERE "firmId" = $1 FOR UPDATE`, ["f1"]);
        await tx.query(`WITH x AS (SELECT * FROM firm FOR UPDATE) SELECT count(*) FROM x`);
        await tx.query(`INSERT INTO meta (key, value) VALUES ('k', 'v')`);
      }),
    ).toEqual([]);
  });

  it("fails closed on a write it cannot attribute: no types, so clients refresh everything", async () => {
    const forms = [
      `WITH moved AS (DELETE FROM firm RETURNING *) INSERT INTO drift_event SELECT * FROM moved`,
      `UPDATE other_schema.firm SET "firmName" = 'x'`,
      `TRUNCATE firm`,
      `MERGE INTO firm USING firm2 ON true WHEN MATCHED THEN DO NOTHING`,
      `INSERT INTO table_9x (a) VALUES (1)`,
      `INSERT INTO some_future_table (a) VALUES (1)`,
    ];
    for (const sql of forms) {
      const log = writeLog();
      // A known write first, so the empty answer can only come from the unrecognised one.
      await insertObject(log.track(stub), "Firm", { firmId: "f1" });
      await log.track(stub).query(sql);
      expect(log.types(), sql).toEqual([]);
    }
  });

  it("resolves quoted, public-qualified and digit-bearing names it can match", () => {
    expect(statementWrites(`UPDATE ONLY "firm" SET a = 1`)).toEqual(["Firm"]);
    expect(statementWrites(`INSERT INTO public.firm (a) VALUES (1)`)).toEqual(["Firm"]);
    expect(statementWrites(`  delete from "public"."mandate"`)).toEqual(["Mandate"]);
    expect(statementWrites(`SELECT 1`)).toEqual([]);
  });
});
