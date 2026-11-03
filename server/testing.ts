import { randomUUID } from "node:crypto";
import type { ActionName, ObjectOf, Props } from "../shared/schema.js";
import { type ApplyOptions, applyAction } from "./actions/apply.js";
import type { ActionResult } from "./actions/types.js";
import { WRITABLE_TABLES, typesForTable } from "./actions/writes.js";
import { type Db, createPgliteDb } from "./db/client.js";
import { ddl } from "./db/ddl.js";
import { getObject, insertObject } from "./db/repo.js";

/** Fixed clock for action tests. */
export const T0 = new Date("2026-09-01T12:00:00.000Z");

/** A CF firm that scores 18/18, tier A, under rubric v2. */
export const STRONG_CF: Props<"Firm"> = {
  firmType: "CF",
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

/** Fresh in-memory Postgres with the full schema. One per test. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await db.exec(ddl());
  return db;
}

export async function seedFirm(db: Db, overrides: Props<"Firm"> = {}): Promise<ObjectOf<"Firm">> {
  const firmId = overrides.firmId ?? `firm-${randomUUID().slice(0, 8)}`;
  await insertObject(db, "Firm", {
    firmName: "Test Advisors",
    firmType: "CF",
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
  });
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
  opts: ApplyOptions = {},
): Promise<ActionResult> {
  const before = await tableFingerprints(db);
  const result = await applyAction(db, name, params, { now: T0, ...opts });
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
