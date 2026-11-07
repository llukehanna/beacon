import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECT_TYPES, type ObjectTypeDef } from "../../shared/schema.js";
import { resetDemo } from "../seed/reset.js";
import { type Db, createPgliteDb } from "./client.js";
import { SQL_TYPE, ddl } from "./ddl.js";
import { LEGACY_SCHEMA_SQL } from "./legacySchema.fixture.js";
import { LATEST_MIGRATION, MIGRATIONS, migrate, schemaVersion } from "./migrate.js";

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

/** Every column of the tables this app owns, as Postgres reports it. */
const columnsOf = async (db: Db): Promise<Column[]> =>
  db.query<Column>(
    `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name NOT LIKE 'snapshot\\_%' AND table_name NOT IN ('schema_migrations', 'migration_repair')
     ORDER BY table_name, column_name`,
  );

/** The Postgres data_type name for each of the schema's SQL types. */
const DATA_TYPE: Record<string, string> = {
  text: "text",
  integer: "integer",
  "double precision": "double precision",
  boolean: "boolean",
  timestamptz: "timestamp with time zone",
  "text[]": "ARRAY",
};

describe("migrations", () => {
  it("are contiguous and the latest version is exported", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(LATEST_MIGRATION).toBe(MIGRATIONS.length);
    for (const m of MIGRATIONS) {
      expect(m.name, `migration ${m.version}`).toMatch(/^[a-z0-9_]+$/);
      expect(m.sql.trim(), `migration ${m.version}`).not.toBe("");
    }
  });

  it("match the .sql files they are bundled from (run `npm run migrations:gen` after editing one)", () => {
    const dir = path.resolve(__dirname, "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(
      MIGRATIONS.map((m) => ({
        file: `${String(m.version).padStart(4, "0")}_${m.name}.sql`,
        sql: m.sql,
      })),
    ).toEqual(files.map((file) => ({ file, sql: readFileSync(path.join(dir, file), "utf8") })));
  });
});

describe("migrate", () => {
  it("is idempotent: a second run applies nothing", async () => {
    const db = await createPgliteDb();
    expect(await schemaVersion(db)).toBe(0);
    expect(await migrate(db)).toEqual({ applied: MIGRATIONS.map((m) => m.version) });
    expect(await schemaVersion(db)).toBe(LATEST_MIGRATION);
    expect(await migrate(db)).toEqual({ applied: [] });
    const recorded = await db.query<{ version: number; name: string; appliedAt: Date }>(
      `SELECT version, name, "appliedAt" FROM schema_migrations ORDER BY version`,
    );
    expect(recorded.map((r) => [r.version, r.name])).toEqual(
      MIGRATIONS.map((m) => [m.version, m.name]),
    );
    expect(recorded.every((r) => r.appliedAt instanceof Date)).toBe(true);
  });

  it("builds the schema shared/schema.ts describes: each table has exactly its properties, typed", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const cols = await columnsOf(db);
    const byTable = new Map<string, Map<string, string>>();
    const nullable = new Map<string, boolean>();
    for (const c of cols) {
      byTable.set(
        c.table_name,
        (byTable.get(c.table_name) ?? new Map()).set(c.column_name, c.data_type),
      );
      nullable.set(`${c.table_name}.${c.column_name}`, c.is_nullable === "YES");
    }
    for (const t of Object.values(OBJECT_TYPES)) {
      const have = byTable.get(t.table);
      expect(have, `table ${t.table}`).toBeDefined();
      expect([...have!.keys()].sort(), t.table).toEqual(Object.keys(t.properties).sort());
      for (const [name, type] of Object.entries(t.properties)) {
        expect(have!.get(name), `${t.table}.${name}`).toBe(DATA_TYPE[SQL_TYPE[type]]);
        // Only the primary key and the columns the type lists as required refuse null.
        const required =
          name === t.primaryKey || ((t as ObjectTypeDef).required ?? []).includes(name);
        expect(nullable.get(`${t.table}.${name}`), `${t.table}.${name} nullable`).toBe(!required);
      }
      for (const name of (t as ObjectTypeDef).required ?? []) {
        expect(Object.keys(t.properties), `${t.table}.${name} is a property`).toContain(name);
      }
    }
    // Beyond the object tables there is only the join table and meta.
    const objectTables = new Set<string>(Object.values(OBJECT_TYPES).map((t) => t.table));
    expect([...byTable.keys()].filter((t) => !objectTables.has(t)).sort()).toEqual([
      "meta",
      "search_list_firm",
    ]);
  });

  it("builds what ddl() describes, indexes included", async () => {
    const generated = await createPgliteDb();
    await generated.exec(ddl());
    const migrated = await createPgliteDb();
    await migrate(migrated);
    expect(await columnsOf(migrated)).toEqual(await columnsOf(generated));
    // The unique constraint on a rule's predicate (0003) is not in the schema; integrity.test.ts covers it.
    const indexes = (db: Db) =>
      db.query<{ indexname: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename NOT IN ('schema_migrations', 'migration_repair') AND indexname <> 'proposed_rule_predicate_key' ORDER BY indexname`,
      );
    expect(await indexes(migrated)).toEqual(await indexes(generated));
  });

  it("baseline migration adopts a database created by the old ensureSchema", async () => {
    const db = await createPgliteDb();
    await db.exec(LEGACY_SCHEMA_SQL);
    // A database created before some columns existed, with rows in it.
    await db.exec(`ALTER TABLE firm DROP COLUMN "revenueBand", DROP COLUMN "ownership"`);
    await db.exec(`ALTER TABLE proposed_rule DROP COLUMN "mandateScope"`);
    await db.exec(
      `INSERT INTO firm ("firmId", "firmName", "successionRisk") VALUES ('f1', 'Alpha Advisors', 'high')`,
    );
    await db.exec(
      `INSERT INTO proposed_rule ("proposedRuleId", "ruleStatus", "proposedAt") VALUES ('r1', 'pending', '2026-09-01T00:00:00Z')`,
    );
    await db.exec(
      `INSERT INTO meta (key, value) VALUES ('lastResetAt', '2026-09-01T00:00:00.000Z')`,
    );
    expect(await schemaVersion(db)).toBe(0);

    expect(await migrate(db)).toEqual({ applied: MIGRATIONS.map((m) => m.version) });

    expect(await schemaVersion(db)).toBe(LATEST_MIGRATION);
    // The rows are intact, and the columns the old database lacked are there, empty.
    expect(
      await db.query(
        `SELECT "firmId", "firmName", "successionRisk", "revenueBand", "ownership" FROM firm`,
      ),
    ).toEqual([
      {
        firmId: "f1",
        firmName: "Alpha Advisors",
        successionRisk: "high",
        revenueBand: null,
        ownership: null,
      },
    ]);
    expect(await db.query(`SELECT "ruleStatus", "mandateScope" FROM proposed_rule`)).toEqual([
      { ruleStatus: "pending", mandateScope: null },
    ]);
    expect(await db.query(`SELECT value FROM meta WHERE key = 'lastResetAt'`)).toEqual([
      { value: "2026-09-01T00:00:00.000Z" },
    ]);
    // It now has the same shape as a database migrated from nothing.
    const fresh = await createPgliteDb();
    await migrate(fresh);
    expect(await columnsOf(db)).toEqual(await columnsOf(fresh));
    expect(await migrate(db)).toEqual({ applied: [] });
  });

  it("0002 strips the run date from search names and 'dated' from drift axes, snapshots included", async () => {
    const db = await createPgliteDb();
    await db.exec(LEGACY_SCHEMA_SQL);
    await db.exec(`
      INSERT INTO firm ("firmId", "firmName") VALUES ('f1', 'One');
      INSERT INTO mandate ("mandateId", title, "createdAt") VALUES ('m1', 'M', '2026-09-01T00:00:00Z');
      INSERT INTO search ("searchId", name, "mandateId", "runAt") VALUES
        ('s1', 'Sell-side of Acme · 2026-09-01', 'm1', '2026-09-01T00:00:00Z'),
        ('s2', 'No date in this one', 'm1', '2026-09-01T00:00:00Z'),
        ('s3', 'Mid · dot · 2026-09-02', 'm1', '2026-09-01T00:00:00Z');
      INSERT INTO drift_event ("driftEventId", "firmId", "detectedAt", "changedAxes") VALUES
        ('d1', 'f1', now(), '[{"axis":"Deal Size","old":"a","new":"b","source":"rescore","dated":"2026-09-01T10:00:00.000Z"},{"axis":"Age","old":null,"new":"c","source":"rescore","dated":"2026-09-01T10:00:00.000Z"}]'),
        ('d2', 'f1', now(), '[]'),
        ('d3', 'f1', now(), NULL);
      CREATE TABLE snapshot_search AS TABLE search;
      CREATE TABLE snapshot_drift_event AS TABLE drift_event;
    `);
    await migrate(db);
    const names = (t: string) =>
      db.query<{ name: string }>(`SELECT name FROM ${t} ORDER BY "searchId"`);
    for (const t of ["search", "snapshot_search"]) {
      expect(
        (await names(t)).map((r) => r.name),
        t,
      ).toEqual(["Sell-side of Acme", "No date in this one", "Mid · dot"]);
    }
    for (const t of ["drift_event", "snapshot_drift_event"]) {
      const rows = await db.query<{ changedAxes: string | null }>(
        `SELECT "changedAxes" FROM ${t} ORDER BY "driftEventId"`,
      );
      expect(JSON.parse(rows[0].changedAxes!), t).toEqual([
        { axis: "Deal Size", old: "a", new: "b", source: "rescore" },
        { axis: "Age", old: null, new: "c", source: "rescore" },
      ]);
      expect(rows[1].changedAxes, t).toBe("[]");
      expect(rows[2].changedAxes, t).toBeNull();
    }
  });

  it("0002 runs on a database that has no snapshot tables", async () => {
    const db = await createPgliteDb();
    await expect(migrate(db)).resolves.toEqual({ applied: MIGRATIONS.map((m) => m.version) });
  });

  it("two concurrent migrate calls apply each version once", async () => {
    const db = await createPgliteDb();
    const [a, b] = await Promise.all([migrate(db), migrate(db)]);
    expect([...a.applied, ...b.applied].sort()).toEqual(MIGRATIONS.map((m) => m.version));
    const recorded = await db.query<{ version: number }>(
      `SELECT version FROM schema_migrations ORDER BY version`,
    );
    expect(recorded.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("rolls the whole run back when a migration fails, recording nothing", async () => {
    const db = await createPgliteDb();
    const broken: Db = {
      ...db,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            ...tx,
            exec: (sql) =>
              sql.includes("regexp_replace") ? Promise.reject(new Error("boom")) : tx.exec(sql),
          }),
        ),
    };
    await expect(migrate(broken)).rejects.toThrow("boom");
    expect(await schemaVersion(db)).toBe(0);
    expect(await db.query(`SELECT to_regclass('firm') AS t`)).toEqual([{ t: null }]);
  });

  it("leaves a reset working on a migrated database", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    await expect(resetDemo(db, new Date("2026-09-01T12:00:00Z"))).resolves.toMatchObject({
      firms: 700,
    });
    expect(await migrate(db)).toEqual({ applied: [] });
  }, 300_000);
});
