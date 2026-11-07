import { beforeAll, describe, expect, it } from "vitest";
import { ruleKey } from "../../shared/predicate.js";
import { OBJECT_TYPES, type ObjectTypeDef, type PropType } from "../../shared/schema.js";
import { heuristicClusterer } from "../clustering/heuristic.js";
import type { Clusterer } from "../clustering/types.js";
import { resetDemo } from "../seed/reset.js";
import { resetFromSnapshot, saveSnapshot } from "../seed/snapshot.js";
import { createTestDb, run, seedFirm } from "../testing.js";
import { type Db, type Tx, createPgliteDb } from "./client.js";
import { APPEND_ONLY_TABLES, MUTABLE_COLUMNS } from "./history.js";
import { MIGRATIONS, migrate, schemaVersion } from "./migrate.js";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const LONG = 600_000;

/** A table the constraints cover: its columns' types, its key and the columns that may not be null. */
interface Shape {
  table: string;
  primaryKey: string;
  types: Readonly<Record<string, PropType>>;
  required: readonly string[];
}

const SHAPES: Shape[] = [
  ...Object.values<ObjectTypeDef>(OBJECT_TYPES).map((t) => ({
    table: t.table,
    primaryKey: t.primaryKey,
    types: t.properties,
    required: t.required ?? [],
  })),
  {
    table: "search_list_firm",
    primaryKey: "searchId",
    types: { searchId: "string", firmId: "string" },
    required: ["searchId", "firmId"],
  },
];
const shapeOf = (table: string): Shape => SHAPES.find((s) => s.table === table)!;

/** Every foreign key migration 0003 adds: the referencing column and the key it must name. */
const REFERENCES: ReadonlyArray<{ table: string; column: string; parent: string; key: string }> = [
  { table: "firm", column: "discoveredViaSearchId", parent: "search", key: "searchId" },
  { table: "search", column: "mandateId", parent: "mandate", key: "mandateId" },
  { table: "search_list", column: "mandateId", parent: "mandate", key: "mandateId" },
  { table: "mandate_access", column: "mandateId", parent: "mandate", key: "mandateId" },
  { table: "search_membership", column: "searchId", parent: "search", key: "searchId" },
  { table: "search_membership", column: "firmId", parent: "firm", key: "firmId" },
  { table: "search_list_firm", column: "searchId", parent: "search_list", key: "searchId" },
  { table: "search_list_firm", column: "firmId", parent: "firm", key: "firmId" },
  { table: "research_finding", column: "firmId", parent: "firm", key: "firmId" },
  { table: "extraction", column: "firmId", parent: "firm", key: "firmId" },
  { table: "qualification_score", column: "firmId", parent: "firm", key: "firmId" },
  { table: "review_decision", column: "firmId", parent: "firm", key: "firmId" },
  { table: "drift_event", column: "firmId", parent: "firm", key: "firmId" },
  { table: "market_signal", column: "firmId", parent: "firm", key: "firmId" },
  { table: "restricted_firm", column: "firmId", parent: "firm", key: "firmId" },
  {
    table: "hard_screen_config",
    column: "sourceProposedRuleId",
    parent: "proposed_rule",
    key: "proposedRuleId",
  },
];

const sample = (type: PropType, name: string): unknown =>
  type === "timestamp"
    ? "2026-09-01T00:00:00.000Z"
    : type === "integer" || type === "double"
      ? 1
      : type === "boolean"
        ? true
        : type === "string[]"
          ? []
          : `x-${name}`;

/** A row with its key and every required column set. */
function probeRow(shape: Shape, nullColumn?: string): Record<string, unknown> {
  const row: Record<string, unknown> = { [shape.primaryKey]: `probe-${shape.table}` };
  for (const c of shape.required) {
    row[c] = c === nullColumn ? null : sample(shape.types[c], c);
  }
  return row;
}

const insertRow = (q: Pick<Tx, "query">, table: string, row: Record<string, unknown>) => {
  const cols = Object.keys(row);
  return q.query(
    `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
};

/** Thrown to roll a transaction back after its statements were accepted. */
class Rollback extends Error {}
const rolledBack = (db: Db, fn: (tx: Tx) => Promise<unknown>) =>
  db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback("rolled back");
  });

const one = async <T>(db: Db, sql: string): Promise<T> => (await db.query<T>(sql))[0];

describe("database integrity, on a seeded database", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
    await resetDemo(db, NOW);
    await saveSnapshot(db, NOW);
  }, LONG);

  describe("required columns", () => {
    for (const shape of SHAPES.filter((s) => s.required.length > 0)) {
      it(`required columns reject null: ${shape.table}`, async () => {
        // The probe row is accepted when complete, so a failure below is the one column's.
        await expect(
          rolledBack(db, (tx) => insertRow(tx, shape.table, probeRow(shape))),
        ).rejects.toThrow(Rollback);
        for (const column of shape.required) {
          await expect(
            insertRow(db, shape.table, probeRow(shape, column)),
            `${shape.table}.${column}`,
          ).rejects.toThrow(new RegExp(`null value in column "${column}"`));
        }
      });
    }

    it("covers every required column that shared/schema.ts lists, and only those", async () => {
      const notNull = await db.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND is_nullable = 'NO'
            AND table_name NOT LIKE 'snapshot\\_%' AND table_name NOT IN ('schema_migrations', 'migration_repair')`,
      );
      const have = new Set(notNull.map((r) => `${r.table_name}.${r.column_name}`));
      const want = new Set<string>();
      for (const s of SHAPES) {
        want.add(`${s.table}.${s.primaryKey}`);
        for (const c of s.required) {
          want.add(`${s.table}.${c}`);
        }
      }
      // meta has its own key and an always-set time.
      want.add("meta.key");
      want.add("meta.updatedAt");
      expect([...have].sort()).toEqual([...want].sort());
    });
  });

  describe("references", () => {
    it("references reject an unknown firm", async () => {
      await expect(
        db.transaction((tx) =>
          insertRow(tx, "research_finding", {
            ...probeRow(shapeOf("research_finding")),
            firmId: "nope",
          }),
        ),
      ).rejects.toThrow(/violates foreign key constraint "research_finding_firm_fkey"/);
      expect(
        await db.query(
          `SELECT 1 FROM research_finding WHERE "findingId" = 'probe-research_finding'`,
        ),
      ).toEqual([]);
    });

    it("are exactly the sixteen listed, each checked at commit", async () => {
      const fks = await db.query<{
        tbl: string;
        col: string;
        parent: string;
        condeferrable: boolean;
        condeferred: boolean;
      }>(
        `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS parent,
                c.condeferrable, c.condeferred
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.contype = 'f' AND n.nspname = current_schema()
          ORDER BY 1, 2`,
      );
      const line = (t: string, c: string, p: string) => `${t}.${c} -> ${p}`;
      expect(fks.map((f) => line(f.tbl, f.col, f.parent)).sort()).toEqual(
        REFERENCES.map((r) => line(r.table, r.column, r.parent)).sort(),
      );
      expect(fks.every((f) => f.condeferrable && f.condeferred)).toBe(true);
    });

    for (const ref of REFERENCES) {
      it(`${ref.table}.${ref.column} rejects a value that names no ${ref.parent}`, async () => {
        const shape = shapeOf(ref.table);
        const row = probeRow(shape);
        // Every other reference on the row names a real parent, so only this column is wrong.
        for (const other of REFERENCES.filter((r) => r.table === ref.table)) {
          const [{ id }] = await db.query<{ id: string }>(
            `SELECT "${other.key}" AS id FROM ${other.parent} LIMIT 1`,
          );
          row[other.column] = id;
        }
        row[ref.column] = "nope";
        await expect(db.transaction((tx) => insertRow(tx, ref.table, row))).rejects.toThrow(
          /violates foreign key constraint/,
        );
      });
    }

    it("are checked at commit, so a child may be inserted before its parent", async () => {
      await expect(
        rolledBack(db, async (tx) => {
          await insertRow(tx, "research_finding", {
            ...probeRow(shapeOf("research_finding")),
            firmId: "late-firm",
          });
          await insertRow(tx, "firm", { firmId: "late-firm" });
          await tx.query(`SET CONSTRAINTS ALL IMMEDIATE`); // checks now what commit would check
        }),
      ).rejects.toThrow(Rollback);
    });
  });

  describe("history", () => {
    it("has one trigger per append-only table, and no other history table has one", async () => {
      const triggers = await db.query<{ tgname: string; tbl: string }>(
        `SELECT t.tgname, t.tgrelid::regclass::text AS tbl FROM pg_trigger t
          WHERE NOT t.tgisinternal ORDER BY 2`,
      );
      expect(triggers).toEqual(
        [...APPEND_ONLY_TABLES].sort().map((tbl) => ({ tgname: `${tbl}_append_only`, tbl })),
      );
    });

    it(
      "history rejects update and delete but reset and status transitions still work",
      async () => {
        // Scores and decisions: no UPDATE, no DELETE.
        for (const [table, key, set] of [
          ["qualification_score", "scoreId", `"tier" = 'Z'`],
          ["review_decision", "decisionId", `"decidedBy" = 'someone-else'`],
        ] as const) {
          const { id } = await one<{ id: string }>(
            db,
            `SELECT "${key}" AS id FROM ${table} LIMIT 1`,
          );
          await expect(
            db.query(`UPDATE ${table} SET ${set} WHERE "${key}" = $1`, [id]),
            `${table} update`,
          ).rejects.toThrow(`${table} is append-only`);
          await expect(
            db.query(`DELETE FROM ${table} WHERE "${key}" = $1`, [id]),
            `${table} delete`,
          ).rejects.toThrow(`${table} is append-only`);
          // Even a no-op update is refused, so the table cannot be rewritten in place.
          await expect(db.query(`UPDATE ${table} SET "${key}" = "${key}"`)).rejects.toThrow(
            `${table} is append-only`,
          );
        }

        // A finding: the record never changes, only its status and verification stamp.
        const { id } = await one<{ id: string }>(
          db,
          `SELECT "findingId" AS id FROM research_finding
          WHERE "value" IS NOT NULL AND "provider" IS NOT NULL AND "findingStatus" = 'proposed' LIMIT 1`,
        );
        for (const set of [
          `"value" = 'changed'`,
          `"provider" = 'someone-else'`,
          `"sourceQuote" = 'a different quote'`,
          `"firmId" = 'another-firm'`,
          `"normalizedScore" = coalesce("normalizedScore", 0) + 1`,
          `"retrievedAt" = "retrievedAt" + interval '1 day'`,
          `"value" = 'changed', "findingStatus" = 'verified'`, // a status change does not excuse the rest
        ]) {
          await expect(
            db.query(`UPDATE research_finding SET ${set} WHERE "findingId" = $1`, [id]),
            set,
          ).rejects.toThrow("research_finding is append-only");
        }
        await expect(
          db.query(`DELETE FROM research_finding WHERE "findingId" = $1`, [id]),
        ).rejects.toThrow("research_finding is append-only");

        // What the actions change still changes, one column at a time and together.
        const stamp = `"verifiedBy" = 'analyst', "verifiedAt" = '2026-09-22T12:00:00Z'`;
        for (const set of [
          `"findingStatus" = 'rejected'`,
          `"verifiedByHuman" = true`,
          `"verifiedBy" = 'analyst'`,
          `"verifiedAt" = '2026-09-22T12:00:00Z'`,
          `"findingStatus" = 'verified', "verifiedByHuman" = true, ${stamp}`,
          `"value" = "value", "findingStatus" = 'superseded'`, // an unchanged column is not a change
        ]) {
          await db.query(`UPDATE research_finding SET ${set} WHERE "findingId" = $1`, [id]);
        }
        expect(
          await one(
            db,
            `SELECT "findingStatus", "verifiedByHuman", "verifiedBy" FROM research_finding WHERE "findingId" = '${id}'`,
          ),
        ).toEqual({ findingStatus: "superseded", verifiedByHuman: true, verifiedBy: "analyst" });

        // The reset truncates and rebuilds the history: TRUNCATE fires no row trigger.
        await expect(resetDemo(db, NOW)).resolves.toMatchObject({ firms: 700 });
        const [{ n }] = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM research_finding`,
        );
        expect(n).toBeGreaterThan(0);
      },
      LONG,
    );

    it("lists exactly the columns an UPDATE may change", () => {
      expect(Object.keys(MUTABLE_COLUMNS).sort()).toEqual([...APPEND_ONLY_TABLES].sort());
      expect(MUTABLE_COLUMNS.research_finding).toEqual([
        "findingStatus",
        "verifiedByHuman",
        "verifiedBy",
        "verifiedAt",
      ]);
    });
  });

  describe("reset", () => {
    const TABLES: string[] = [
      ...Object.values(OBJECT_TYPES)
        .map((t) => t.table)
        .filter((t) => !["action_run", "model_call", "access_log_entry"].includes(t)),
      "search_list_firm",
    ];
    const fingerprint = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const t of TABLES) {
        const [r] = await db.query<{ h: string }>(
          `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x`,
        );
        out[t] = r.h;
      }
      return out;
    };

    it(
      "reset restores the snapshot with constraints on",
      async () => {
        await resetFromSnapshot(db, NOW); // the history test above rebuilt the world with new ids
        // The constraints are all there when the reset runs.
        const [{ fks }] = await db.query<{ fks: number }>(
          `SELECT count(*)::int AS fks FROM pg_constraint WHERE contype = 'f'`,
        );
        expect(fks).toBe(REFERENCES.length);
        const [{ uniques }] = await db.query<{ uniques: number }>(
          `SELECT count(*)::int AS uniques FROM pg_indexes WHERE indexname = 'proposed_rule_predicate_key' AND indexdef LIKE 'CREATE UNIQUE INDEX%'`,
        );
        expect(uniques).toBe(1);

        const before = await fingerprint();
        // Dirty the demo the way a visitor would, then restore it.
        await db.query(
          `UPDATE firm SET "employees" = 1 WHERE "firmId" = (SELECT min("firmId") FROM firm)`,
        );
        await db.query(`DELETE FROM drift_event`);
        await db.query(`DELETE FROM search_membership`);
        expect(await fingerprint()).not.toEqual(before);
        await expect(resetFromSnapshot(db, NOW)).resolves.toEqual({ firms: 700 });
        expect(await fingerprint()).toEqual(before);
        // Nothing the restore wrote is waiting on a deferred check.
        await db.transaction((tx) => tx.query(`SET CONSTRAINTS ALL IMMEDIATE`));
      },
      LONG,
    );

    it(
      "a snapshot that breaks a constraint fails the reset and leaves the demo as it was",
      async () => {
        const before = await fingerprint();
        await db.query(
          `INSERT INTO snapshot_research_finding ("findingId", "firmId", "retrievedAt") VALUES ('orphan', 'ghost', now())`,
        );
        try {
          await expect(resetFromSnapshot(db, NOW)).rejects.toThrow(/foreign key/);
          expect(await fingerprint()).toEqual(before);
        } finally {
          await db.query(`DELETE FROM snapshot_research_finding WHERE "findingId" = 'orphan'`);
        }
        await expect(resetFromSnapshot(db, NOW)).resolves.toEqual({ firms: 700 });
      },
      LONG,
    );
  });
});

/** A Db whose transactions read the proposed rules as empty on their first look, as a transaction that began before another committed would. */
function blindToRules(real: Db): Db {
  let stale = true;
  return {
    ...real,
    transaction: (fn) =>
      real.transaction((tx) =>
        fn({
          ...tx,
          query: (sql: string, params?: unknown[]) => {
            if (stale && /^\s*SELECT[\s\S]*FROM proposed_rule\b/i.test(sql)) {
              stale = false; // only the first read, the one that lists what exists
              return Promise.resolve([]);
            }
            return tx.query(sql, params);
          },
        }),
      ),
  };
}

describe("one proposed rule per predicate", () => {
  /** Five small firms rejected for being small: the heuristic clusters them into one rule. */
  async function rejectedSmallFirms(db: Db): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const f = await seedFirm(db, { employees: 4 + i });
      await run(db, "rejectFirm", {
        firm: f.$primaryKey,
        rejectionRationale: `Too small, ${4 + i} staff.`,
      });
    }
  }
  const rules = (db: Db) =>
    db.query<{
      proposedRuleId: string;
      predicateAxis: string;
      ruleOperator: string;
      ruleThreshold: string;
      ruleModel: string | null;
    }>(`SELECT * FROM proposed_rule`);

  it("concurrent clustering yields one rule per key", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const results = await Promise.allSettled([
      run(db, "clusterRejections", {}, { clusterer: heuristicClusterer }),
      run(db, "clusterRejections", {}, { clusterer: heuristicClusterer }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const stored = await rules(db);
    expect(stored.length).toBeGreaterThan(0);
    const keys = stored.map((r) =>
      ruleKey(r.predicateAxis, r.ruleOperator, r.ruleThreshold, r.ruleModel),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a run that did not see the other's rule yields to it instead of failing", async () => {
    const real = await createTestDb();
    await rejectedSmallFirms(real);
    await run(real, "clusterRejections", {}, { clusterer: heuristicClusterer });
    const [existing] = await rules(real);
    // This run's transaction reads the rules as they were before the other committed (two requests
    // in flight on separate connections), so only the database can say the rule is taken.
    const blind = blindToRules(real);
    const result = await run(blind, "clusterRejections", {}, { clusterer: heuristicClusterer });
    expect(await rules(real)).toHaveLength(1);
    expect(result.created).toEqual([]);
    expect(result.note).toContain(`already proposed: ${existing.proposedRuleId}`);
  });

  it("Employees racing employees lands one rule", async () => {
    const db = await createTestDb();
    await rejectedSmallFirms(db);
    const shouting: Clusterer = async (rows) => {
      const out = await heuristicClusterer(rows);
      return {
        ...out,
        proposals: out.proposals.map((p) => ({
          ...p,
          predicateAxis: ` ${p.predicateAxis.replace(/^./, (c) => c.toUpperCase())} `,
        })),
      };
    };
    // The second run cannot see the first's rule, as when both are in flight at once.
    await run(db, "clusterRejections", {}, { clusterer: heuristicClusterer });
    const before = await rules(db);
    const result = await run(blindToRules(db), "clusterRejections", {}, { clusterer: shouting });
    expect(result.created).toEqual([]);
    expect(result.note).toContain("already proposed");
    expect(await rules(db)).toEqual(before);
  });

  /** Predicates as a run might write them, some the same rule by ruleKey and some not. */
  const KEYS: Array<[string, string, string, string | null]> = [
    // axis, operator, threshold, model
    ["employees", "<", "10", "both"],
    ["Employees", "<", "10", "both"],
    ["  EMPLOYEES ", " < ", " 10 ", "BOTH"],
    ["employees", "<", "10", null],
    ["employees", "<", "10", ""],
    ["employees", "<", "10", "CF"],
    ["employees", "<", "10", " cf"],
    ["employees", "<", "10", "   "],
    ["employees", "<", "10", "CS"],
    ["employees", "<", "9", "both"],
    ["employees", "<=", "10", "both"],
    ["firm_age", "<", "10", "both"],
    ["coverage_model", "==", "Generalist", "both"],
    ["coverage_model", "==", "generalist", "both"],
    ["coverage_model", "==", "Generalist", "CF"],
    ["employees", "<", "", "both"],
    ["employees", "<", "  ", null],
  ];

  it("the unique index and ruleKey agree on whether two predicates are the same rule", async () => {
    const db = await createTestDb();
    const insert = (id: string, k: (typeof KEYS)[number]) =>
      db.query(
        `INSERT INTO proposed_rule ("proposedRuleId", "predicateAxis", "ruleOperator", "ruleThreshold", "ruleModel", "proposedAt")
         VALUES ($1, $2, $3, $4, $5, now())`,
        [id, k[0], k[1], k[2], k[3]],
      );
    let pairs = 0;
    let sameKey = 0;
    for (let i = 0; i < KEYS.length; i++) {
      for (let j = i + 1; j < KEYS.length; j++) {
        const same =
          ruleKey(KEYS[i][0], KEYS[i][1], KEYS[i][2], KEYS[i][3]) ===
          ruleKey(KEYS[j][0], KEYS[j][1], KEYS[j][2], KEYS[j][3]);
        await db.query(`DELETE FROM proposed_rule`);
        await insert("a", KEYS[i]);
        const second = insert("b", KEYS[j]);
        if (same) {
          await expect(
            second,
            `${JSON.stringify(KEYS[i])} ~ ${JSON.stringify(KEYS[j])}`,
          ).rejects.toThrow(/proposed_rule_predicate_key/);
          sameKey++;
        } else {
          await expect(
            second,
            `${JSON.stringify(KEYS[i])} != ${JSON.stringify(KEYS[j])}`,
          ).resolves.toBeDefined();
        }
        pairs++;
      }
    }
    // The table has both kinds of pair in it, so the test cannot pass by agreeing on one answer.
    expect(sameKey).toBeGreaterThan(5);
    expect(pairs - sameKey).toBeGreaterThan(50);
  });
});

describe("migration 0003 on a database that already holds rows", () => {
  /** A database as production is today: every migration before `version` applied, none after. */
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

  const ids = async (db: Db, table: string, key: string): Promise<string[]> =>
    (await db.query<{ id: string }>(`SELECT "${key}" AS id FROM ${table} ORDER BY 1`)).map(
      (r) => r.id,
    );

  it("repairs what the constraints would refuse, logs each repair, and keeps the rest", async () => {
    const db = await migratedBefore(3);
    await db.exec(`
      INSERT INTO firm ("firmId", "firmName", "discoveredViaSearchId") VALUES
        ('f1', 'One', NULL), ('f2', 'Two', NULL), ('f-via-orphan', 'Three', 's-orphan');
      INSERT INTO mandate ("mandateId", "title", "createdAt") VALUES
        ('m1', 'Kept', '2026-09-01T00:00:00Z'), ('m-nodate', 'No date', NULL);
      INSERT INTO mandate_access ("accessId", "mandateId", "persona") VALUES
        ('a1', 'm1', 'analyst'), ('a-ghost', 'm-missing', 'analyst');
      INSERT INTO search ("searchId", "mandateId", "runAt", "name") VALUES
        ('s1', 'm1', '2026-09-01T00:00:00Z', 'Kept'),
        ('s-orphan', 'm-missing', '2026-09-01T00:00:00Z', 'Orphan'),
        ('s-of-nodate', 'm-nodate', '2026-09-01T00:00:00Z', 'Of a mandate removed below');
      INSERT INTO search_membership ("membershipId", "searchId", "firmId") VALUES
        ('sm1', 's1', 'f1'), ('sm-orphan', 's-orphan', 'f1'), ('sm-ghost-firm', 's1', 'ghost');
      INSERT INTO search_list ("searchId", "mandateId", "createdAt") VALUES ('l1', 'm1', now());
      INSERT INTO search_list_firm ("searchId", "firmId") VALUES ('l1', 'f1'), ('l1', 'ghost'), ('l-ghost', 'f1');
      INSERT INTO research_finding ("findingId", "firmId", "retrievedAt") VALUES
        ('rf-ok', 'f1', now()), ('rf-ghost', 'ghost', now());
      INSERT INTO research_finding ("findingId", "firmId", "retrievedAt", "verifiedAt") VALUES
        ('rf-nodate', 'f1', NULL, '2026-09-05T00:00:00Z');
      INSERT INTO research_finding ("findingId", "firmId", "retrievedAt") VALUES
        ('rf-undated', 'f1', NULL), ('rf-nofirm', NULL, now());
      INSERT INTO qualification_score ("scoreId", "firmId", "computedAt") VALUES
        ('qs-ok', 'f1', now()), ('qs-ghost', 'ghost', now());
      INSERT INTO review_decision ("decisionId", "firmId", "decisionType", "decidedAt") VALUES
        ('rd-ok', 'f1', 'reject', now()),
        ('rd-activity', NULL, 'activity', now()),
        ('rd-ghost', 'ghost', 'reject', now());
      INSERT INTO proposed_rule ("proposedRuleId", "predicateAxis", "ruleOperator", "ruleThreshold", "ruleModel", "ruleStatus", "proposedAt") VALUES
        ('r-pending', 'employees', '<', '10', 'both', 'pending', '2026-09-01T00:00:00Z'),
        ('r-approved', 'employees', '<', '10', 'both', 'approved', '2026-09-02T00:00:00Z'),
        ('r-null-a', 'firm_age', '<', '3', NULL, 'dismissed', '2026-09-01T00:00:00Z'),
        ('r-null-b', 'firm_age', '<', '3', NULL, 'pending', '2026-09-03T00:00:00Z'),
        ('r-other', 'employees', '<', '10', 'CF', 'pending', '2026-09-01T00:00:00Z'),
        ('r-case', ' Employees', '<', '10', NULL, 'dismissed', '2026-09-04T00:00:00Z');
      INSERT INTO meta (key, value) VALUES ('snapshotAt', '2026-09-10T00:00:00.000Z');
      INSERT INTO hard_screen_config ("configRuleId", "sourceProposedRuleId", "configCreatedAt") VALUES
        ('hsc-on-keeper', 'r-approved', now()),
        ('hsc-on-duplicate', 'r-pending', now()),
        ('hsc-ghost', 'r-missing', now());
      CREATE TABLE snapshot_firm AS TABLE firm;
      CREATE TABLE snapshot_research_finding AS TABLE research_finding;
    `);

    await expect(migrate(db)).resolves.toEqual({ applied: [3] });
    expect(await schemaVersion(db)).toBe(3);

    // What is kept.
    expect(await ids(db, "firm", "firmId")).toEqual(["f-via-orphan", "f1", "f2"]);
    expect(await ids(db, "mandate", "mandateId")).toEqual(["m-nodate", "m1"]);
    expect(await ids(db, "mandate_access", "accessId")).toEqual(["a1"]);
    expect(await ids(db, "search", "searchId")).toEqual(["s-of-nodate", "s1"]);
    expect(await ids(db, "search_membership", "membershipId")).toEqual(["sm1"]);
    expect(await ids(db, "search_list_firm", "firmId")).toEqual(["f1"]);
    expect(await ids(db, "research_finding", "findingId")).toEqual([
      "rf-nodate",
      "rf-ok",
      "rf-undated",
    ]);
    // An empty timestamp is filled in from what says when, else the time of the migration (the
    // snapshot's own time in its copy), and the row stays.
    const stamp = (table: string, id: string) =>
      db
        .query<{ at: Date }>(`SELECT "retrievedAt" AS at FROM ${table} WHERE "findingId" = '${id}'`)
        .then((r) => r[0].at.toISOString());
    expect(await stamp("research_finding", "rf-nodate")).toBe("2026-09-05T00:00:00.000Z");
    expect(Date.now() - Date.parse(await stamp("research_finding", "rf-undated"))).toBeLessThan(
      60_000,
    );
    expect(await stamp("snapshot_research_finding", "rf-undated")).toBe("2026-09-10T00:00:00.000Z");
    expect(
      await db
        .query<{ at: Date }>(`SELECT "createdAt" AS at FROM mandate WHERE "mandateId" = 'm-nodate'`)
        .then((r) => r[0].at.toISOString()),
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(await ids(db, "qualification_score", "scoreId")).toEqual(["qs-ok"]);
    expect(await ids(db, "review_decision", "decisionId")).toEqual([
      "rd-activity",
      "rd-ghost",
      "rd-ok",
    ]);
    // A decision about a firm that is not there is kept, about no firm; a firm keeps existing
    // without the search that found it.
    expect(
      await db.query(`SELECT "firmId" FROM review_decision WHERE "decisionId" = 'rd-ghost'`),
    ).toEqual([{ firmId: null }]);
    expect(
      await db.query(`SELECT "discoveredViaSearchId" FROM firm WHERE "firmId" = 'f-via-orphan'`),
    ).toEqual([{ discoveredViaSearchId: null }]);
    // One rule per predicate: the approved one, else the pending one, else the oldest. The
    // configs follow the survivor, and a config of no rule goes.
    expect(await ids(db, "proposed_rule", "proposedRuleId")).toEqual([
      "r-approved",
      "r-null-b",
      "r-other",
    ]); // r-pending and r-case share r-approved's key, whatever their case or model spelling
    expect(
      await db.query(
        `SELECT "configRuleId", "sourceProposedRuleId" FROM hard_screen_config ORDER BY 1`,
      ),
    ).toEqual([
      { configRuleId: "hsc-on-duplicate", sourceProposedRuleId: "r-approved" },
      { configRuleId: "hsc-on-keeper", sourceProposedRuleId: "r-approved" },
    ]);
    // The reset's copy is repaired too, or the next reset would fail on it.
    expect(await ids(db, "snapshot_research_finding", "findingId")).toEqual([
      "rf-nodate",
      "rf-ok",
      "rf-undated",
    ]);

    // Every repair is logged, with the row as it was.
    const log = await db.query<{
      tableName: string;
      rowKey: string;
      action: string;
      reason: string;
      rowData: Record<string, unknown>;
      version: number;
    }>(`SELECT * FROM migration_repair ORDER BY "repairId"`);
    expect(log.every((r) => r.version === 3)).toBe(true);
    expect(log.map((r) => `${r.tableName} ${r.rowKey} ${r.action}`).sort()).toEqual(
      [
        "firm f-via-orphan cleared",
        "hard_screen_config hsc-ghost deleted",
        "hard_screen_config hsc-on-duplicate repointed",
        "mandate m-nodate backfilled",
        "mandate_access a-ghost deleted",
        "proposed_rule r-case deleted",
        "proposed_rule r-null-a deleted",
        "proposed_rule r-pending deleted",
        "qualification_score qs-ghost deleted",
        "research_finding rf-ghost deleted",
        "research_finding rf-nodate backfilled",
        "research_finding rf-nofirm deleted",
        "research_finding rf-undated backfilled",
        "review_decision rd-ghost cleared",
        "search s-orphan deleted",
        "search_list_firm l-ghost:f1 deleted",
        "search_list_firm l1:ghost deleted",
        "search_membership sm-ghost-firm deleted",
        "search_membership sm-orphan deleted",
        "snapshot_research_finding rf-ghost deleted",
        "snapshot_research_finding rf-nodate backfilled",
        "snapshot_research_finding rf-nofirm deleted",
        "snapshot_research_finding rf-undated backfilled",
      ].sort(),
    );
    const ghost = log.find((r) => r.rowKey === "rf-ghost" && r.tableName === "research_finding")!;
    expect(ghost.rowData).toMatchObject({ findingId: "rf-ghost", firmId: "ghost" });
    expect(ghost.reason).toBe("firmId names no firm");
    const dup = log.find((r) => r.rowKey === "r-pending")!;
    expect(dup.reason).toBe("duplicates the rule r-approved");
    const nofirm = log.find((r) => r.rowKey === "rf-nofirm" && r.tableName === "research_finding")!;
    expect(nofirm.reason).toBe("firmId is required");

    // And the database now holds the line.
    await expect(
      db.query(
        `INSERT INTO research_finding ("findingId", "firmId", "retrievedAt") VALUES ('x', 'f1', NULL)`,
      ),
    ).rejects.toThrow(/null value/);
    await expect(db.query(`DELETE FROM review_decision`)).rejects.toThrow(/append-only/);
    expect(await migrate(db)).toEqual({ applied: [] });
  });

  it("logs nothing when there is nothing to repair", async () => {
    const db = await migratedBefore(3);
    await db.exec(`
      INSERT INTO firm ("firmId", "firmName") VALUES ('f1', 'One');
      INSERT INTO research_finding ("findingId", "firmId", "retrievedAt") VALUES ('rf1', 'f1', now());
    `);
    await migrate(db);
    expect(await db.query(`SELECT * FROM migration_repair`)).toEqual([]);
  });

  it("adds a required timestamp a snapshot copy lacks and backfills it; a missing reference is skipped, and said", async () => {
    const db = await migratedBefore(3);
    await db.exec(`
      INSERT INTO meta (key, value) VALUES ('snapshotAt', '2026-09-10T00:00:00.000Z');
      CREATE TABLE snapshot_research_finding ("findingId" text, "firmId" text);
      INSERT INTO snapshot_research_finding VALUES ('rf1', 'f1');
      CREATE TABLE snapshot_extraction ("extractionId" text, "extractedAt" timestamptz);
      INSERT INTO snapshot_extraction VALUES ('e1', now());
    `);
    await migrate(db);
    expect(
      await db.query(
        `SELECT "tableName", action, reason FROM migration_repair ORDER BY "tableName", action`,
      ),
    ).toEqual([
      {
        tableName: "snapshot_extraction",
        action: "skipped",
        reason: "firmId is missing from the snapshot copy: run npm run seed",
      },
      {
        tableName: "snapshot_research_finding",
        action: "added",
        reason: "retrievedAt was missing from the snapshot copy; added and backfilled",
      },
      {
        tableName: "snapshot_research_finding",
        action: "backfilled",
        reason: "retrievedAt is required and was empty",
      },
    ]);
    const [row] = await db.query<{ at: Date }>(
      `SELECT "retrievedAt" AS at FROM snapshot_research_finding`,
    );
    expect(row.at.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("keeps the rules and active screens of a database from before proposedAt existed", async () => {
    // Production's shape if its tables and its snapshot were saved before ProposedRule.proposedAt:
    // every rule has no time, the snapshot has no such column, and a screen is live on a rule.
    const db = await migratedBefore(3);
    await db.exec(`
      INSERT INTO firm ("firmId", "firmName") VALUES ('f1', 'One');
      INSERT INTO review_decision ("decisionId", "firmId", "decisionType", "decidedAt") VALUES
        ('d1', 'f1', 'reject', '2026-09-01T00:00:00Z'),
        ('d2', 'f1', 'reject', '2026-09-03T00:00:00Z'),
        ('d3', 'f1', 'reject', '2026-09-05T00:00:00Z');
      INSERT INTO proposed_rule ("proposedRuleId", "predicateAxis", "ruleOperator", "ruleThreshold", "ruleModel", "ruleStatus", "supportingDecisionIds", "ruleDecidedAt") VALUES
        ('r-supported', 'employees', '<', '10', 'both', 'approved', '["d1","d2"]', '2026-09-08T00:00:00Z'),
        ('r-decided', 'firm_age', '<', '3', 'both', 'approved', '[]', '2026-09-09T00:00:00Z'),
        ('r-bare', 'deal_size_usd_m', '<', '30', 'both', 'pending', NULL, NULL);
      INSERT INTO hard_screen_config ("configRuleId", "sourceProposedRuleId", "configActive", "configCreatedAt") VALUES
        ('c1', 'r-supported', true, '2026-09-08T00:00:00Z'),
        ('c2', 'r-decided', true, '2026-09-09T00:00:00Z');
      INSERT INTO meta (key, value) VALUES ('snapshotAt', '2026-09-10T00:00:00.000Z');
      CREATE TABLE snapshot_firm AS TABLE firm;
      CREATE TABLE snapshot_review_decision AS TABLE review_decision;
      CREATE TABLE snapshot_hard_screen_config AS TABLE hard_screen_config;
      CREATE TABLE snapshot_proposed_rule AS SELECT "proposedRuleId", "predicateAxis", "ruleOperator", "ruleThreshold", "ruleModel", "ruleStatus", "supportingDecisionIds", "ruleDecidedAt" FROM proposed_rule;
    `);
    expect(
      await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'snapshot_proposed_rule' AND column_name = 'proposedAt'`,
      ),
    ).toEqual([]);

    await migrate(db);

    const at = async (table: string) =>
      (
        await db.query<{ id: string; at: Date }>(
          `SELECT "proposedRuleId" AS id, "proposedAt" AS at FROM ${table} ORDER BY 1`,
        )
      ).map((r): [string, string] => [r.id, r.at.toISOString()]);
    for (const table of ["proposed_rule", "snapshot_proposed_rule"]) {
      const rows = Object.fromEntries(await at(table));
      expect(Object.keys(rows), table).toEqual(["r-bare", "r-decided", "r-supported"]);
      // Proposed when the last supporting decision was made; else when it was decided; else the
      // moment of the migration (the snapshot's own moment in its copy).
      expect(rows["r-supported"], table).toBe("2026-09-03T00:00:00.000Z");
      expect(rows["r-decided"], table).toBe("2026-09-09T00:00:00.000Z");
      if (table === "snapshot_proposed_rule") {
        expect(rows["r-bare"]).toBe("2026-09-10T00:00:00.000Z");
      } else {
        expect(Date.now() - Date.parse(rows["r-bare"])).toBeLessThan(60_000);
      }
    }
    // The screens are still live on their rules.
    expect(
      await db.query(
        `SELECT "configRuleId", "sourceProposedRuleId", "configActive" FROM hard_screen_config ORDER BY 1`,
      ),
    ).toEqual([
      { configRuleId: "c1", sourceProposedRuleId: "r-supported", configActive: true },
      { configRuleId: "c2", sourceProposedRuleId: "r-decided", configActive: true },
    ]);
    // Nothing was deleted, and the log says what was filled in.
    const log = await db.query<{ tableName: string; action: string }>(
      `SELECT "tableName", action FROM migration_repair ORDER BY "repairId"`,
    );
    // One entry per rule filled in, and the column added to the snapshot copy; no deletions.
    expect(log.map((r) => `${r.tableName} ${r.action}`)).toEqual([
      ...Array<string>(3).fill("proposed_rule backfilled"),
      "snapshot_proposed_rule added",
      ...Array<string>(3).fill("snapshot_proposed_rule backfilled"),
    ]);
    // And the reset can restore from the older snapshot.
    await expect(resetFromSnapshot(db, new Date("2026-09-10T00:00:00Z"))).resolves.toEqual({
      firms: 1,
    });
    expect(await db.query(`SELECT count(*)::int AS n FROM proposed_rule`)).toEqual([{ n: 3 }]);
    expect(
      await db.query(`SELECT count(*)::int AS n FROM hard_screen_config WHERE "configActive"`),
    ).toEqual([{ n: 2 }]);
  });

  it("rolls back whole when the repair fails part way", async () => {
    const db = await migratedBefore(3);
    // The repair fails part way through: the transaction takes the earlier steps back with it.
    await db.exec(`INSERT INTO firm ("firmId", "firmName") VALUES ('f1', 'One')`);
    const broken: Db = {
      ...db,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            ...tx,
            exec: (sql) =>
              sql.includes("beacon_repair_nulls")
                ? Promise.reject(new Error("boom"))
                : tx.exec(sql),
          }),
        ),
    };
    await expect(migrate(broken)).rejects.toThrow("boom");
    expect(await schemaVersion(db)).toBe(2);
    expect(await db.query(`SELECT to_regclass('migration_repair') AS t`)).toEqual([{ t: null }]);
    expect(await ids(db, "firm", "firmId")).toEqual(["f1"]);
  });
});
