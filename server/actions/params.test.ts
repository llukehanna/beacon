import { describe, expect, it } from "vitest";
import { NO_WALL } from "../access.js";
import type { Queryable } from "../db/client.js";
import { insertObject } from "../db/repo.js";
import { createTestDb } from "../testing.js";
import { MAX_LIST, MAX_STRING, resolveParams } from "./params.js";

/** The params under test, as a caller with no wall (the wall has its own tests in server/barrier.test.ts). */
const resolve = (db: Queryable, spec: Parameters<typeof resolveParams>[1], raw: unknown) =>
  resolveParams(db, spec, raw, NO_WALL);

describe("resolveParams", () => {
  it("resolves object references and accepts nullable gaps", async () => {
    const db = await createTestDb();
    await insertObject(db, "Firm", { firmId: "f1", firmName: "A" });
    const out = await resolve(
      db,
      { firm: { type: { object: "Firm" } }, note: { type: "string", nullable: true } },
      { firm: "f1" },
    );
    expect((out.firm as { firmName: string }).firmName).toBe("A");
    expect(out.note).toBeUndefined();
  });

  it("rejects missing, mistyped, unknown, and dangling parameters", async () => {
    const db = await createTestDb();
    const spec = {
      n: { type: "integer" as const },
      tags: { type: "string[]" as const, nullable: true },
    };
    await expect(resolve(db, spec, {})).rejects.toThrow(/Missing required parameter "n"/);
    await expect(resolve(db, spec, { n: 1.5 })).rejects.toThrow(/"n" must be an integer/);
    await expect(resolve(db, spec, { n: 1, tags: [1] })).rejects.toThrow(
      /"tags" must be a list of strings/,
    );
    await expect(resolve(db, spec, { n: 1, extra: true })).rejects.toThrow(
      /Unknown parameter "extra"/,
    );
    await expect(
      resolve(db, { firm: { type: { object: "Firm" } } }, { firm: "ghost" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("bounds strings and lists", async () => {
    const db = await createTestDb();
    const spec = {
      note: { type: "string" as const, nullable: true },
      names: { type: "string[]" as const, nullable: true },
    };
    await expect(resolve(db, spec, { note: "x".repeat(MAX_STRING + 1) })).rejects.toThrow(
      /longer than/,
    );
    await expect(
      resolve(db, spec, { names: Array.from({ length: MAX_LIST + 1 }, (_, i) => `n${i}`) }),
    ).rejects.toThrow(/at most/);
    await expect(resolve(db, spec, { names: ["y".repeat(500)] })).rejects.toThrow(/at most/);
  });

  it("normalizes timestamps to ISO and rejects unparseable ones", async () => {
    const db = await createTestDb();
    const spec = { at: { type: "timestamp" as const } };
    expect(await resolve(db, spec, { at: "2026-09-22T12:00:00+02:00" })).toEqual({
      at: "2026-09-22T10:00:00.000Z",
    });
    await expect(resolve(db, spec, { at: "last tuesday" })).rejects.toThrow(/ISO timestamp/);
    await expect(resolve(db, spec, { at: 1758535200000 })).rejects.toThrow(/ISO timestamp/);
  });
});
