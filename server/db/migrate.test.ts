import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECT_TYPES, type ObjectTypeDef } from "../../shared/schema.js";
import { resetDemo } from "../seed/reset.js";
import { resetFromSnapshot } from "../seed/snapshot.js";
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
        (byTable.get(c.table_name) ?? new Map<string, string>()).set(c.column_name, c.data_type),
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
    // Beyond the object tables there is only the current-trait view, the join table and meta.
    const objectTables = new Set<string>(Object.values(OBJECT_TYPES).map((t) => t.table));
    expect([...byTable.keys()].filter((t) => !objectTables.has(t)).sort()).toEqual([
      "firm_trait_current",
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
    // The rows are intact, the firm's trait column became its trait value, and the columns the
    // old database lacked are there, empty.
    expect(await db.query(`SELECT "firmId", "firmName" FROM firm`)).toEqual([
      { firmId: "f1", firmName: "Alpha Advisors" },
    ]);
    expect(
      await db.query(`SELECT "firmId", "traitKey", "valueString" FROM firm_trait_current`),
    ).toEqual([{ firmId: "f1", traitKey: "succession_risk", valueString: "high" }]);
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

/** A database with every migration before `version` applied, none after. */
async function migratedBefore(version: number): Promise<Db> {
  const db = await createPgliteDb();
  await db.exec(
    `CREATE TABLE schema_migrations (version integer PRIMARY KEY, name text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())`,
  );
  for (const m of MIGRATIONS.filter((x) => x.version < version)) {
    await db.exec(m.sql);
    await db.query(`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, [
      m.version,
      m.name,
    ]);
  }
  return db;
}

describe("migration 0005: firm trait values", () => {
  /** Each firm's current traits as one map per firm, read from `table` (latest revision wins). */
  const currentTraits = async (db: Db, table = "firm_trait_value") =>
    Object.fromEntries(
      (
        await db.query<{ firmId: string; traits: Record<string, unknown> }>(
          `SELECT "firmId", jsonb_object_agg("traitKey",
                    coalesce(to_jsonb("valueString"), to_jsonb("valueNumber"), to_jsonb("valueBoolean"))) AS traits
             FROM (SELECT DISTINCT ON ("firmId", "traitKey") * FROM ${table}
                    ORDER BY "firmId", "traitKey", "revision" DESC) v
            GROUP BY "firmId"`,
        )
      ).map((r) => [r.firmId, r.traits]),
    );

  const FULL = {
    firmId: "full",
    firmType: "CS",
    servicesFit: "Full private-capital suite",
    mdPedigree: "Senior credit / capital-markets pedigree",
    balanceSheetPrincipal: "Advisory only",
    dealSizeMUsd: 120.5,
    dealsPerMdL3y: 2.5,
    firmAge: 14,
    feeGeneratingCount: 4,
    advisoryConflict: false,
    hasSTOrBalanceSheet: false,
    webActivity: true,
    solvent: true,
    coverageModel: "Multi-sector",
    geoScore: 2,
    employees: 30,
    revenueBand: "$10–25M",
    ownership: "Partnership",
    successionRisk: "Low",
    enrichedAt: "2026-09-01T00:00:00Z",
  };
  const FULL_TRAITS = {
    services_fit: "Full private-capital suite",
    md_pedigree: "Senior credit / capital-markets pedigree",
    balance_sheet_principal: "Advisory only",
    deal_size_usd_m: 120.5,
    deals_per_md_l3y: 2.5,
    firm_age: 14,
    fee_generating_count: 4,
    advisory_conflict: false,
    has_st_or_balance_sheet: false,
    web_activity: true,
    solvent: true,
    coverage_model: "Multi-sector",
    geo_score: 2,
    employees: 30,
    revenue_band: "$10–25M",
    ownership: "Partnership",
    succession_risk: "Low",
  };

  async function withFirms(db: Db): Promise<void> {
    const insert = async (row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      await db.query(
        `INSERT INTO firm (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row),
      );
    };
    await insert(FULL);
    await insert({ firmId: "sparse", firmType: "CF", employees: 12 });
    await insert({ firmId: "bare" });
  }

  it("backfills one revision per non-empty legacy column, and the thesis from firmType", async () => {
    const db = await migratedBefore(5);
    await withFirms(db);
    await migrate(db);
    expect(await currentTraits(db)).toEqual({ full: FULL_TRAITS, sparse: { employees: 12 } });
    expect(
      await db.query(
        `SELECT "traitValueId", "revision", "setBy", "setAt" FROM firm_trait_value
          WHERE "firmId" = 'full' AND "traitKey" = 'firm_age'`,
      ),
    ).toEqual([
      {
        traitValueId: "full:firm_age:1",
        revision: 1,
        setBy: "migration",
        setAt: new Date("2026-09-01T00:00:00Z"),
      },
    ]);
    expect(await db.query(`SELECT "firmId", "thesis" FROM firm ORDER BY 1`)).toEqual([
      { firmId: "bare", thesis: null },
      { firmId: "full", thesis: "CS" },
      { firmId: "sparse", thesis: "CF" },
    ]);
  });

  it("fills the snapshot too, so a reset before the next reseed keeps every firm's traits", async () => {
    const db = await migratedBefore(5);
    await withFirms(db);
    await db.exec(`CREATE TABLE snapshot_firm AS TABLE firm`);
    await db.query(
      `INSERT INTO meta (key, value) VALUES ('snapshotAt', '2026-09-01T12:00:00.000Z')`,
    );
    await migrate(db);
    expect(await currentTraits(db, "snapshot_firm_trait_value")).toEqual({
      full: FULL_TRAITS,
      sparse: { employees: 12 },
    });
    await resetFromSnapshot(db, new Date("2026-09-02T12:00:00.000Z"));
    expect(await currentTraits(db)).toEqual({ full: FULL_TRAITS, sparse: { employees: 12 } });
    expect(await db.query(`SELECT "thesis" FROM firm WHERE "firmId" = 'full'`)).toEqual([
      { thesis: "CS" },
    ]);
  });
});

describe("migration 0006: the legacy trait columns go", () => {
  const LEGACY = [
    "firmType",
    "servicesFit",
    "mdPedigree",
    "balanceSheetPrincipal",
    "dealSizeMUsd",
    "dealsPerMdL3y",
    "firmAge",
    "feeGeneratingCount",
    "advisoryConflict",
    "hasSTOrBalanceSheet",
    "webActivity",
    "solvent",
    "coverageModel",
    "geoScore",
    "employees",
    "revenueBand",
    "ownership",
    "successionRisk",
  ];

  const columnsOf = async (db: Db, table: string) =>
    (
      await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1`,
        [table],
      )
    ).map((r) => r.column_name);

  it("drops them from firm and its snapshot, keeping each firm's traits and thesis", async () => {
    const db = await migratedBefore(5);
    await db.query(
      `INSERT INTO firm ("firmId", "firmType", "employees", "coverageModel") VALUES ('f1', 'CS', 12, 'Generalist')`,
    );
    await db.exec(`CREATE TABLE snapshot_firm AS TABLE firm`);
    await db.query(
      `INSERT INTO meta (key, value) VALUES ('snapshotAt', '2026-09-01T12:00:00.000Z')`,
    );
    await migrate(db);
    for (const table of ["firm", "snapshot_firm"]) {
      const columns = await columnsOf(db, table);
      expect(columns).toContain("thesis");
      expect(LEGACY.filter((c) => columns.includes(c))).toEqual([]);
    }
    await resetFromSnapshot(db, new Date("2026-09-02T12:00:00.000Z"));
    expect(await db.query(`SELECT "firmId", "thesis" FROM firm`)).toEqual([
      { firmId: "f1", thesis: "CS" },
    ]);
    expect(
      await db.query(
        `SELECT "traitKey", "valueString", "valueNumber" FROM firm_trait_current ORDER BY 1`,
      ),
    ).toEqual([
      { traitKey: "coverage_model", valueString: "Generalist", valueNumber: null },
      { traitKey: "employees", valueString: null, valueNumber: 12 },
    ]);
  });

  it("refuses to drop a column value that has no trait value, and changes nothing", async () => {
    const db = await migratedBefore(6);
    await db.query(`INSERT INTO firm ("firmId", "employees") VALUES ('f1', 12)`);
    await expect(migrate(db)).rejects.toThrow(/f1.*employees/);
    expect(await schemaVersion(db)).toBe(5);
    expect(await columnsOf(db, "firm")).toContain("employees");
  });

  it("refuses to drop a firm type that never became a thesis", async () => {
    const db = await migratedBefore(6);
    await db.query(`INSERT INTO firm ("firmId", "firmType") VALUES ('f1', 'CS')`);
    await expect(migrate(db)).rejects.toThrow(/f1.*firmType/);
  });

  it("marks the whole-number traits in the catalog and its snapshot", async () => {
    const db = await migratedBefore(6);
    await db.exec(`CREATE TABLE snapshot_trait AS TABLE trait`);
    await migrate(db);
    for (const table of ["trait", "snapshot_trait"]) {
      expect(
        await db.query(`SELECT "traitKey" FROM ${table} WHERE "wholeNumber" ORDER BY "position"`),
      ).toEqual([
        { traitKey: "firm_age" },
        { traitKey: "fee_generating_count" },
        { traitKey: "geo_score" },
        { traitKey: "employees" },
      ]);
    }
  });
});
