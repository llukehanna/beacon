import { describe, expect, it } from "vitest";
import { resetDemo } from "../seed/reset.js";
import { createPgliteDb } from "./client.js";
import { ddl } from "./ddl.js";
import { getMeta } from "./meta.js";

describe("ddl", () => {
  it("adds columns introduced after a table was created", async () => {
    const db = await createPgliteDb();
    await db.exec(ddl());
    // A database created before Firm.revenueBand and Firm.ownership existed.
    await db.exec(`ALTER TABLE firm DROP COLUMN "revenueBand", DROP COLUMN "ownership"`);
    const columns = async () =>
      (
        await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'firm'`,
        )
      ).map((r) => r.column_name);
    expect(await columns()).not.toContain("revenueBand");

    await db.exec(ddl());
    expect(await columns()).toEqual(expect.arrayContaining(["revenueBand", "ownership"]));

    await expect(resetDemo(db, new Date("2026-09-01T12:00:00Z"))).resolves.toMatchObject({
      firms: 700,
    });
    expect(await getMeta(db, "lastResetAt")).not.toBeNull();
  });

  it("is idempotent", async () => {
    const db = await createPgliteDb();
    await db.exec(ddl());
    await expect(db.exec(ddl())).resolves.not.toThrow();
  });
});
