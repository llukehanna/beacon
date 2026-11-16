import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client.js";
import { setMeta } from "../db/meta.js";
import { createTestDb } from "../testing.js";
import { IDLE_RESET_MS, changedThenIdle } from "./idle.js";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await setMeta(db, "lastResetAt", "2026-11-07T08:00:00.000Z");
});

async function actionAt(iso: string, ok = true): Promise<void> {
  await db.query(
    `INSERT INTO action_run ("actionRunId", "actionName", "startedAt", "durationMs", "ok")
     VALUES ($1, 'rejectFirm', $2, 10, $3)`,
    [`run-${iso}-${ok}`, iso, ok],
  );
}

const at = (iso: string) => new Date(iso);

describe("changedThenIdle", () => {
  it("is false when nothing has run since the last reset", async () => {
    await actionAt("2026-11-07T07:00:00.000Z");
    expect(await changedThenIdle(db, at("2026-11-07T09:00:00.000Z"))).toBe(false);
  });

  it("is false while the latest action is recent", async () => {
    await actionAt("2026-11-07T08:45:00.000Z");
    expect(await changedThenIdle(db, at("2026-11-07T09:00:00.000Z"))).toBe(false);
  });

  it("is true once the latest action is older than the idle window", async () => {
    await actionAt("2026-11-07T08:10:00.000Z");
    await actionAt("2026-11-07T08:25:00.000Z");
    expect(await changedThenIdle(db, at("2026-11-07T09:00:00.000Z"))).toBe(true);
    expect(IDLE_RESET_MS).toBe(30 * 60 * 1000);
  });

  it("ignores failed actions, which wrote nothing", async () => {
    await actionAt("2026-11-07T08:10:00.000Z", false);
    expect(await changedThenIdle(db, at("2026-11-07T09:00:00.000Z"))).toBe(false);
  });

  it("is false when no reset was ever recorded", async () => {
    await db.query(`DELETE FROM meta WHERE key = 'lastResetAt'`);
    await actionAt("2026-11-07T08:10:00.000Z");
    expect(await changedThenIdle(db, at("2026-11-07T09:00:00.000Z"))).toBe(false);
  });
});
