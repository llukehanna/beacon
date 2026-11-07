import { beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { createTestDb } from "../testing.js";
import { type Db, runTransaction } from "./client.js";
import { claimDailyQuota, claimWindow, getMeta, setMeta } from "./meta.js";
import {
  MAX_PAGE_SIZE,
  getObject,
  insertObject,
  insertObjects,
  listAll,
  listLinked,
  listObjects,
  updateObject,
} from "./repo.js";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("repository", () => {
  it("round-trips arrays and timestamps and omits nulls", async () => {
    await insertObject(db, "Mandate", {
      mandateId: "m1",
      title: "T",
      geographies: ["Europe"],
      createdAt: "2026-09-01T12:00:00.000Z",
      priority: null,
    });
    const m = await getObject(db, "Mandate", "m1");
    expect(m).toMatchObject({
      $apiName: "Mandate",
      $primaryKey: "m1",
      title: "T",
      geographies: ["Europe"],
      createdAt: "2026-09-01T12:00:00.000Z",
    });
    expect(m && "priority" in m).toBe(false);
  });

  it("rejects properties the schema does not declare", async () => {
    await expect(
      insertObject(db, "Mandate", { mandateId: "m1", colour: "red" } as never),
    ).rejects.toThrow(/Unknown property "colour"/);
  });

  it("updates, clears with null, and 404s on a missing row", async () => {
    await insertObject(db, "Firm", { firmId: "f1", firmName: "A", disposition: "x" });
    await updateObject(db, "Firm", "f1", { firmName: "B", disposition: null });
    const f = await getObject(db, "Firm", "f1");
    expect(f?.firmName).toBe("B");
    expect(f?.disposition).toBeUndefined();
    await expect(updateObject(db, "Firm", "nope", { firmName: "C" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("filters with $eq and orders by a property", async () => {
    await insertObject(db, "Firm", { firmId: "a", firmName: "Zed", firmType: "CF" });
    await insertObject(db, "Firm", { firmId: "b", firmName: "Amy", firmType: "CF" });
    await insertObject(db, "Firm", { firmId: "c", firmName: "Cat", firmType: "CS" });
    const { data: rows } = await listObjects(db, "Firm", {
      where: { firmType: { $eq: "CF" } },
      orderBy: { firmName: "asc" },
    });
    expect(rows.map((r) => r.firmName)).toEqual(["Amy", "Zed"]);
  });

  it("refuses unsupported filters and unknown sort keys", async () => {
    await expect(
      listObjects(db, "Firm", { where: { firmType: { $gt: "A" } as never } }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(listObjects(db, "Firm", { orderBy: { nope: "asc" } })).rejects.toThrow(
      /Unknown property/,
    );
  });

  it("rejects inherited/prototype property names, not just own-property misses", async () => {
    await expect(
      listObjects(db, "Firm", { where: { constructor: { $eq: "x" } } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listObjects(db, "Firm", { orderBy: { toString: "asc" } as never }),
    ).rejects.toMatchObject({ status: 400 });
  });

  describe("paging", () => {
    const seedFive = async () => {
      // Out of key order, with two ties on firmType and one null firmName.
      const rows = [
        ["f1", "Echo", "CF"],
        ["f2", "Bravo", "CS"],
        ["f3", null, "CF"],
        ["f4", "Delta", "CF"],
        ["f5", "Alpha", "CS"],
      ] as const;
      for (const [firmId, firmName, firmType] of rows) {
        await insertObject(db, "Firm", { firmId, firmName, firmType });
      }
    };
    const pages = async (opts: Parameters<typeof listObjects>[2]) => {
      const out: string[][] = [];
      let pageToken: string | undefined;
      do {
        const page = await listObjects(db, "Firm", { ...opts, pageToken });
        out.push(page.data.map((r) => r.$primaryKey));
        pageToken = page.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    };

    it("pages of 2, 2, 1 then stops", async () => {
      await seedFive();
      const first = await listObjects(db, "Firm", { pageSize: 2 });
      expect(first.data.map((r) => r.$primaryKey)).toEqual(["f1", "f2"]);
      expect(first.nextPageToken).toEqual(expect.any(String));
      const second = await listObjects(db, "Firm", {
        pageSize: 2,
        pageToken: first.nextPageToken!,
      });
      expect(second.data.map((r) => r.$primaryKey)).toEqual(["f3", "f4"]);
      const third = await listObjects(db, "Firm", {
        pageSize: 2,
        pageToken: second.nextPageToken!,
      });
      expect(third.data.map((r) => r.$primaryKey)).toEqual(["f5"]);
      expect(third.nextPageToken).toBeNull();
    });

    it("returns an empty last page when the rows divide evenly", async () => {
      await insertObject(db, "Firm", { firmId: "a" });
      await insertObject(db, "Firm", { firmId: "b" });
      const first = await listObjects(db, "Firm", { pageSize: 2 });
      expect(first.data).toHaveLength(2);
      const next = await listObjects(db, "Firm", { pageSize: 2, pageToken: first.nextPageToken! });
      expect(next).toEqual({ data: [], nextPageToken: null });
    });

    it("keeps the order across pages, nulls last and in either direction", async () => {
      await seedFive();
      const everything = async (orderBy: Record<string, "asc" | "desc">) =>
        (await listObjects(db, "Firm", { orderBy })).data.map((r) => r.$primaryKey);
      const orders: Record<string, "asc" | "desc">[] = [
        { firmName: "asc" },
        { firmName: "desc" },
        { firmType: "desc", firmName: "asc" },
        { firmType: "asc", firmName: "desc" },
      ];
      for (const orderBy of orders) {
        expect((await pages({ orderBy, pageSize: 2 })).flat(), JSON.stringify(orderBy)).toEqual(
          await everything(orderBy),
        );
      }
      expect(await everything({ firmName: "asc" })).toEqual(["f5", "f2", "f4", "f1", "f3"]);
    });

    it("resumes correctly after a page that ends on a null sort key", async () => {
      await seedFive();
      await insertObject(db, "Firm", { firmId: "f6", firmType: "CF" }); // second null firmName
      for (const dir of ["asc", "desc"] as const) {
        const all = (await listObjects(db, "Firm", { orderBy: { firmName: dir } })).data.map(
          (r) => r.$primaryKey,
        );
        // Nulls sort last in either direction, ordered by primary key.
        expect(all.slice(-2)).toEqual(["f3", "f6"]);
        // Page sizes 5 and 6 end a page exactly on a null row (f3, then f6) with rows still to come or not.
        for (const pageSize of [5, 6, 1, 4]) {
          expect(
            (await pages({ orderBy: { firmName: dir }, pageSize })).flat(),
            `${dir}/${pageSize}`,
          ).toEqual(all);
        }
      }
      const endsOnNull = await listObjects(db, "Firm", {
        orderBy: { firmName: "asc" },
        pageSize: 5,
      });
      expect(endsOnNull.data.at(-1)?.$primaryKey).toBe("f3");
      const rest = await listObjects(db, "Firm", {
        orderBy: { firmName: "asc" },
        pageSize: 5,
        pageToken: endsOnNull.nextPageToken!,
      });
      expect(rest.data.map((r) => r.$primaryKey)).toEqual(["f6"]);
    });

    it("applies where together with the cursor", async () => {
      await seedFive();
      expect(
        await pages({
          where: { firmType: { $eq: "CF" } },
          orderBy: { firmName: "asc" },
          pageSize: 2,
        }),
      ).toEqual([["f4", "f1"], ["f3"]]);
    });

    it("caps pageSize at MAX_PAGE_SIZE and rejects nonsense", async () => {
      await seedFive();
      const page = await listObjects(db, "Firm", { pageSize: 5000 });
      expect(page.data).toHaveLength(5);
      await expect(listObjects(db, "Firm", { pageSize: 0 })).rejects.toMatchObject({ status: 400 });
      await expect(listObjects(db, "Firm", { pageSize: 1.5 })).rejects.toMatchObject({
        status: 400,
      });
      expect(MAX_PAGE_SIZE).toBe(1000);
    });

    it("rejects tokens that are not cursors for this query", async () => {
      await seedFive();
      for (const pageToken of ["not-base64!", "", "AAAA", btoa('["x"]'), btoa("[1,2]")]) {
        await expect(listObjects(db, "Firm", { pageToken }), pageToken).rejects.toMatchObject({
          status: 400,
        });
      }
      const { nextPageToken } = await listObjects(db, "Firm", { pageSize: 1 });
      await expect(
        listObjects(db, "Firm", { orderBy: { firmName: "asc" }, pageToken: nextPageToken! }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("listAll follows every page", async () => {
      await db.query(
        `INSERT INTO firm ("firmId") SELECT 'g' || lpad(i::text, 5, '0') FROM generate_series(1, ${MAX_PAGE_SIZE + 5}) i`,
      );
      expect(await listAll(db, "Firm")).toHaveLength(MAX_PAGE_SIZE + 5);
    });
  });

  it("traverses a join-table link for many sources at once", async () => {
    await insertObject(db, "Firm", { firmId: "f1", firmName: "One" });
    await insertObject(db, "Firm", { firmId: "f2", firmName: "Two" });
    await db.query(
      `INSERT INTO search_list_firm ("searchId","firmId") VALUES ('L1','f1'),('L1','f2'),('L2','f2')`,
    );
    const out = await listLinked(db, "SearchList", "firms", ["L1", "L2", "L3"], []);
    expect(out.L1.map((f) => f.$primaryKey)).toEqual(["f1", "f2"]);
    expect(out.L2.map((f) => f.$primaryKey)).toEqual(["f2"]);
    expect(out.L3).toEqual([]);
  });

  it("stores meta values", async () => {
    expect(await getMeta(db, "k")).toBeNull();
    await setMeta(db, "k", "v1");
    await setMeta(db, "k", "v2");
    expect(await getMeta(db, "k")).toBe("v2");
  });

  it("rolls back a failed transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await insertObject(tx, "Firm", { firmId: "t1", firmName: "Temp" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await getObject(db, "Firm", "t1")).toBeNull();
  });
});

describe("claimWindow", () => {
  it("claims once per window", async () => {
    const db = await createTestDb();
    const t = new Date("2026-09-22T12:00:00Z");
    expect(await claimWindow(db, "w", t, 60_000)).toBe(true);
    expect(await claimWindow(db, "w", new Date(t.getTime() + 59_999), 60_000)).toBe(false);
    expect(await getMeta(db, "w")).toBe(t.toISOString());
    expect(await claimWindow(db, "w", new Date(t.getTime() + 60_000), 60_000)).toBe(true);
  });
});

describe("insertObjects", () => {
  it("inserts many rows in one statement with their types intact", async () => {
    const db = await createTestDb();
    await insertObjects(db, "Firm", [
      { firmId: "a", firmName: "A", employees: 12, geoScore: 2 },
      { firmId: "b", firmName: "B" },
    ]);
    expect(await getObject(db, "Firm", "a")).toMatchObject({
      firmName: "A",
      employees: 12,
      geoScore: 2,
    });
    expect((await getObject(db, "Firm", "b"))?.employees).toBeUndefined();
    await expect(insertObjects(db, "Firm", [{ firmName: "no pk" }])).rejects.toThrow(/missing/);
  });
});

describe("claimDailyQuota", () => {
  it("allows max units per UTC day, then resets the next day", async () => {
    const db = await createTestDb();
    const day1 = new Date("2026-09-22T08:00:00Z");
    for (let i = 0; i < 3; i++) {
      expect(await claimDailyQuota(db, "q", day1, 3)).toBe(true);
    }
    expect(await claimDailyQuota(db, "q", new Date("2026-09-22T23:59:00Z"), 3)).toBe(false);
    expect(await getMeta(db, "q")).toBe("2026-09-22:3");
    expect(await claimDailyQuota(db, "q", new Date("2026-09-23T00:01:00Z"), 3)).toBe(true);
    expect(await getMeta(db, "q")).toBe("2026-09-23:1");
    await setMeta(db, "q", "2026-09-23:garbage");
    expect(await claimDailyQuota(db, "q", new Date("2026-09-23T02:00:00Z"), 3)).toBe(true);
    expect(await getMeta(db, "q")).toBe("2026-09-23:1");
  });
});

describe("runTransaction", () => {
  function fakeClient(failOn?: string) {
    const sql: string[] = [];
    const released: unknown[] = [];
    return {
      sql,
      released,
      client: {
        async query(text: string) {
          sql.push(text);
          if (text === failOn) {
            throw new Error(`${text} failed`);
          }
          return { rows: [] };
        },
        release(err?: Error | boolean) {
          released.push(err);
        },
      },
    };
  }

  it("commits and releases the client cleanly on success", async () => {
    const { client, sql, released } = fakeClient();
    await expect(runTransaction(client, async () => "ok")).resolves.toBe("ok");
    expect(sql).toEqual(["BEGIN", "COMMIT"]);
    expect(released).toEqual([undefined]);
  });

  it("rolls back and releases the client with the error when the work throws", async () => {
    const { client, sql, released } = fakeClient();
    const boom = new Error("boom");
    await expect(
      runTransaction(client, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(sql).toEqual(["BEGIN", "ROLLBACK"]);
    expect(released).toEqual([boom]);
  });

  it("surfaces the original error and destroys the client when ROLLBACK itself throws", async () => {
    const { client, released } = fakeClient("ROLLBACK");
    const boom = new Error("boom");
    await expect(
      runTransaction(client, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(released).toEqual([boom]);
  });

  it("destroys the client when COMMIT fails", async () => {
    const { client, released } = fakeClient("COMMIT");
    await expect(runTransaction(client, async () => 1)).rejects.toThrow("COMMIT failed");
    expect(released).toHaveLength(1);
    expect(released[0]).toBeInstanceOf(Error);
  });
});
