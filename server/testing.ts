import { randomUUID } from "node:crypto";
import type { RubricContext } from "../shared/rubric/types.js";
import type { ActionName, ObjectOf, Props } from "../shared/schema.js";
import { ADVISORY_ACQUISITIONS } from "../shared/workspaces/advisoryAcquisitions.js";
import { NO_WALL } from "./access.js";
import { type ApplyOptions, applyAction } from "./actions/apply.js";
import type { ActionResult } from "./actions/types.js";
import { WRITABLE_TABLES, typesForTable } from "./actions/writes.js";
import { type Db, createPgliteDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { getObject } from "./db/repo.js";
import { insertFirms } from "./seed/firms.js";

/** Fixed clock for action tests. */
export const T0 = new Date("2026-09-01T12:00:00.000Z");

/** A CF firm that scores 18/18, tier A, under rubric v2. */
export const STRONG_CF: Props<"Firm"> = {
  thesis: "CF",
  coverageModel: "Single-sector focus",
  servicesFit: "Full advisory suite",
  mdPedigree: "Bulge-bracket or elite-boutique alumni",
  geoScore: 2,
  dealSizeMUsd: 200,
  dealsPerMdL3y: 5,
  firmAge: 15,
  employees: 20,
  feeGeneratingCount: 4,
};

/** The rubric and catalog every test database starts with (migration 0004 writes them). */
export const TEST_RUBRIC: RubricContext = {
  definition: ADVISORY_ACQUISITIONS.rubric,
  traits: ADVISORY_ACQUISITIONS.traits,
};

/** Fresh in-memory Postgres with the full schema. One per test. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db); // migration 0004 writes the catalog and the active rubric
  return db;
}

/** Test firm fields, which may name traits by today's column names (as STRONG_CF does). */
export type TestFirm = Props<"Firm"> & { traits?: Record<string, unknown> };

/** A test firm as the record to insert and its traits, read from column names and `traits`. */
function splitTestFirm(fields: TestFirm): { row: Props<"Firm">; traits: Record<string, unknown> } {
  const row: Record<string, unknown> = {};
  const traits: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const key = ADVISORY_ACQUISITIONS.legacyFields[name];
    if (name === "traits") {
      continue;
    } else if (key !== undefined) {
      if (value !== undefined && value !== null) {
        traits[key] = value;
      }
    } else {
      row[name] = value;
    }
  }
  return { row: row, traits: { ...traits, ...fields.traits } };
}

/** Insert test firms, their traits stored as trait values. Each must carry its firmId. */
export async function insertTestFirms(db: Db, firms: readonly TestFirm[]): Promise<void> {
  await insertFirms(
    db,
    firms.map((f) => {
      const { row, traits } = splitTestFirm(f);
      return { ...row, firmId: f.firmId!, traits };
    }),
    { setBy: "seed", setAt: T0.toISOString() },
  );
}

/**
 * A firm for a test: the record, with its traits stored as trait values. `overrides` may name traits
 * by today's column names (`employees`, `dealSizeMUsd`, as STRONG_CF does) or pass `traits` by key.
 */
export async function seedFirm(db: Db, overrides: TestFirm = {}): Promise<ObjectOf<"Firm">> {
  const firmId = overrides.firmId ?? `firm-${randomUUID().slice(0, 8)}`;
  await insertTestFirms(db, [
    {
      firmName: "Test Advisors",
      thesis: "CF",
      hqCountry: "United States",
      geography: "US",
      geographicFootprint: "US",
      geoScore: 2,
      sector: "Software",
      employees: 25,
      coverageModel: "Single-sector focus",
      lifecycleState: "Screening",
      currentStage: "Screening",
      ...overrides,
      firmId,
    },
  ]);
  return (await getObject(db, "Firm", firmId))!;
}

/** A fingerprint of every table an action can write, to tell which ones it changed. */
async function tableFingerprints(db: Db): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of WRITABLE_TABLES) {
    const [row] = await db.query<{ h: string }>(
      `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM ${table} t`,
    );
    out[table] = row.h;
  }
  return out;
}

/**
 * Applies an action and checks that the object types it reports having
 * written cover every table whose rows actually changed (clients refresh only
 * the reported types; an empty report means "refresh everything" and is
 * always acceptable).
 */
export async function run(
  db: Db,
  name: ActionName,
  params: Record<string, unknown>,
  opts: Partial<ApplyOptions> = {},
): Promise<ActionResult> {
  const before = await tableFingerprints(db);
  const result = await applyAction(db, name, params, { now: T0, access: NO_WALL, ...opts });
  const after = await tableFingerprints(db);
  const reported = result.types ?? [];
  if (reported.length > 0) {
    for (const table of WRITABLE_TABLES) {
      const missing = typesForTable(table).filter((t) => !reported.includes(t));
      if (before[table] !== after[table] && missing.length > 0) {
        throw new Error(`${name} changed ${table} but reported types [${reported.join(", ")}]`);
      }
    }
  }
  return result;
}
