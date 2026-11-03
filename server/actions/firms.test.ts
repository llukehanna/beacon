import { describe, expect, it } from "vitest";
import { getObject, listAll } from "../db/repo.js";
import { STRONG_CF, createTestDb, run, seedFirm } from "../testing.js";

const byFirm = (firmId: string) => ({ where: { firmId: { $eq: firmId } } });

describe("qualifyFirm", () => {
  it("snapshots the score, marks the firm Qualified, and logs an accept", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    const after = await getObject(db, "Firm", firm.$primaryKey);
    expect(after).toMatchObject({
      lifecycleState: "Qualified",
      currentStage: "Qualified",
      tierAtQualification: "A",
      scoreAtQualification: 18,
    });
    expect(await listAll(db, "QualificationScore", byFirm(firm.$primaryKey))).toHaveLength(1);
    const decisions = await listAll(db, "ReviewDecision", byFirm(firm.$primaryKey));
    expect(decisions.map((d) => [d.decisionType, d.tierAtDecision, d.decidedBy])).toEqual([
      ["accept", "A", "demo-analyst"],
    ]);
  });

  it("names the object types it wrote to, so clients refresh only those", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    const result = await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    expect(result.types).toEqual(["Firm", "QualificationScore", "ReviewDecision"]);
    expect(result.modified).toEqual([firm.$primaryKey]);
  });

  it("qualifies from Discovered or Screening, and refuses once past Qualified", async () => {
    const db = await createTestDb();
    for (const lifecycleState of ["Discovered", "Screening"]) {
      const firm = await seedFirm(db, { lifecycleState, currentStage: lifecycleState });
      await run(db, "qualifyFirm", { firm: firm.$primaryKey });
      expect((await getObject(db, "Firm", firm.$primaryKey))?.lifecycleState).toBe("Qualified");
    }
    const later = await seedFirm(db, { lifecycleState: "NDA", currentStage: "NDA" });
    await expect(run(db, "qualifyFirm", { firm: later.$primaryKey })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses a firm that is already Passed", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Passed" });
    await expect(run(db, "qualifyFirm", { firm: firm.$primaryKey })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("rejectFirm", () => {
  it("requires a rationale", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db);
    await expect(
      run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "  " }),
    ).rejects.toThrow(/rationale/);
  });

  it("rejects, snapshots, and records the rationale", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { employees: 6, currentStage: "Screening" });
    await run(db, "rejectFirm", {
      firm: firm.$primaryKey,
      rejectionRationale: "Too small — 6 staff.",
    });
    expect(await getObject(db, "Firm", firm.$primaryKey)).toMatchObject({
      lifecycleState: "Passed",
      currentStage: "Passed",
    });
    const [d] = await listAll(db, "ReviewDecision", byFirm(firm.$primaryKey));
    expect([d.decisionType, d.rejectionRationale]).toEqual(["reject", "Too small — 6 staff."]);
    const [s] = await listAll(db, "QualificationScore", byFirm(firm.$primaryKey));
    expect(s.computedBy).toBe("rejectFirm");
  });
});

describe("advanceStage", () => {
  it("refuses to move a firm that has not been qualified", async () => {
    const db = await createTestDb();
    for (const lifecycleState of ["Discovered", "Screening"]) {
      const firm = await seedFirm(db, { lifecycleState, currentStage: lifecycleState });
      await expect(
        run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Outreach" }),
      ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/qualif/i) });
    }
  });

  it("walks a qualified firm one stage at a time through to Closed", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: firm.$primaryKey });
    for (const stage of ["Outreach", "NDA", "IOI", "LOI", "Closed"]) {
      await run(db, "advanceStage", { firm: firm.$primaryKey, targetState: stage });
      expect(await getObject(db, "Firm", firm.$primaryKey)).toMatchObject({
        lifecycleState: stage,
        currentStage: stage,
      });
    }
    await expect(
      run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Closed" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects skipping a stage", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Qualified", currentStage: "Qualified" });
    await expect(
      run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "NDA" }),
    ).rejects.toThrow(/next stage is Outreach/);
  });

  it("refuses a Passed firm", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Passed", currentStage: "Passed" });
    await expect(
      run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Outreach" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not rescore", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "Qualified", currentStage: "Qualified" });
    await run(db, "advanceStage", { firm: firm.$primaryKey, targetState: "Outreach" });
    expect(await listAll(db, "QualificationScore", byFirm(firm.$primaryKey))).toHaveLength(0);
  });
});

describe("rejectFirm from later stages", () => {
  it("passes a firm that is already in NDA", async () => {
    const db = await createTestDb();
    const firm = await seedFirm(db, { lifecycleState: "NDA", currentStage: "NDA" });
    await run(db, "rejectFirm", {
      firm: firm.$primaryKey,
      rejectionRationale: "Terms fell through",
    });
    expect(await getObject(db, "Firm", firm.$primaryKey)).toMatchObject({
      lifecycleState: "Passed",
      currentStage: "Passed",
    });
  });

  it("refuses a firm that is Closed or already Passed", async () => {
    const db = await createTestDb();
    for (const lifecycleState of ["Closed", "Passed"]) {
      const firm = await seedFirm(db, { lifecycleState, currentStage: lifecycleState });
      await expect(
        run(db, "rejectFirm", { firm: firm.$primaryKey, rejectionRationale: "No" }),
      ).rejects.toMatchObject({ status: 409 });
    }
  });
});

describe("applyAction", () => {
  it("404s an unknown action", async () => {
    const db = await createTestDb();
    await expect(run(db, "nope" as never, {})).rejects.toMatchObject({ status: 404 });
  });

  it("refuses actions once the demo's activity tables are full", async () => {
    const db = await createTestDb();
    const a = await seedFirm(db, STRONG_CF);
    const b = await seedFirm(db, STRONG_CF);
    await run(db, "qualifyFirm", { firm: a.$primaryKey }, { maxActivityRows: 2 }); // adds a score and a decision
    await expect(
      run(db, "qualifyFirm", { firm: b.$primaryKey }, { maxActivityRows: 2 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
