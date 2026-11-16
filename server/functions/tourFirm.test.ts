import { beforeEach, describe, expect, it } from "vitest";
import { STRONG_SHOWCASE_FIRM_IDS, TOUR_FIRM_ID } from "../../shared/showcaseFirms.js";
import { NO_WALL, buildAccess } from "../access.js";
import { type Db } from "../db/client.js";
import { insertObjects } from "../db/repo.js";
import { createTestDb } from "../testing.js";
import { tourFirm } from "./tourFirm.js";

const [FIRST, SECOND, THIRD] = STRONG_SHOWCASE_FIRM_IDS;

let db: Db;

/** A strong firm in Screening with a two-finding conflict on firm age, both still proposed. */
async function addFirm(firmId: string, stage = "Screening", conflictStatus = "proposed") {
  await insertObjects(db, "Firm", [
    { firmId, firmName: firmId, lifecycleState: stage, currentStage: stage },
  ]);
  await insertObjects(
    db,
    "ResearchFinding",
    ["a", "b"].map((side) => ({
      findingId: `${firmId}-${side}`,
      firmId,
      axis: "firmAge",
      value: side === "a" ? "24" : "33",
      provider: side === "a" ? "deal_db" : "filings",
      findingStatus: conflictStatus,
      conflictGroupId: `${firmId}-age`,
      retrievedAt: "2026-11-15T00:00:00.000Z",
    })),
  );
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("tourFirm", () => {
  it("opens on the first showcase firm while it is undecided with an open conflict", async () => {
    await addFirm(FIRST);
    await addFirm(SECOND);
    expect(await tourFirm(db, NO_WALL)).toEqual({ firmId: FIRST });
  });

  it("skips a firm the visitor passed", async () => {
    await addFirm(FIRST, "Passed");
    await addFirm(SECOND);
    expect(await tourFirm(db, NO_WALL)).toEqual({ firmId: SECOND });
  });

  it("skips a firm the visitor qualified", async () => {
    await addFirm(FIRST, "Qualified");
    await addFirm(SECOND);
    expect(await tourFirm(db, NO_WALL)).toEqual({ firmId: SECOND });
  });

  it("skips a firm whose conflict the visitor resolved", async () => {
    await addFirm(FIRST, "Screening", "verified");
    await addFirm(SECOND, "Screening", "verified");
    await addFirm(THIRD);
    expect(await tourFirm(db, NO_WALL)).toEqual({ firmId: THIRD });
  });

  it("prefers an undecided firm without a conflict to a decided one", async () => {
    await addFirm(FIRST, "Passed");
    await addFirm(SECOND, "Screening", "verified");
    await addFirm(THIRD, "Passed");
    expect(await tourFirm(db, NO_WALL)).toEqual({ firmId: SECOND });
  });

  it("falls back to the seeded tour firm when every showcase firm is decided", async () => {
    for (const id of STRONG_SHOWCASE_FIRM_IDS) {
      await addFirm(id, "Passed");
    }
    expect(await tourFirm(db, NO_WALL)).toEqual({ firmId: TOUR_FIRM_ID });
  });

  it("never opens on a firm hidden from the persona", async () => {
    await addFirm(FIRST);
    await addFirm(SECOND);
    const analyst = buildAccess("analyst", [{ k: "r", a: FIRST, b: "Live mandate" }]);
    expect(await tourFirm(db, analyst)).toEqual({ firmId: SECOND });
  });
});
