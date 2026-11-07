import type { Db } from "./client.js";
import { MIGRATIONS as BUNDLED } from "./migrations.generated.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Every migration, in order. The SQL lives in `server/db/migrations/NNNN_name.sql`; the bundled copy
 * in `migrations.generated.ts` is what the Worker and the scripts import (`npm run migrations:gen`).
 * Versions run 1..n with no gaps, and a migration that has shipped is never edited: a change is a
 * new file.
 */
export const MIGRATIONS: readonly Migration[] = BUNDLED;

export const LATEST_MIGRATION: number = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/** The key of the advisory lock that serializes migrators on one database. */
const MIGRATE_LOCK = 7_183_620;

/** The newest version recorded in `schema_migrations`; 0 when the table does not exist yet. */
export async function schemaVersion(db: Db): Promise<number> {
  const [{ present }] = await db.query<{ present: boolean }>(
    `SELECT to_regclass('schema_migrations') IS NOT NULL AS present`,
  );
  if (!present) {
    return 0;
  }
  const [{ version }] = await db.query<{ version: number }>(
    `SELECT coalesce(max(version), 0)::int AS version FROM schema_migrations`,
  );
  return version;
}

/**
 * Apply every migration the database has not recorded, in order, and return the versions applied.
 * The whole run is one transaction behind a transaction-level advisory lock: concurrent runners
 * queue, the later ones find nothing to do, and a failing migration leaves the database as it was.
 * `lock_timeout` makes a migration that would wait on a busy table give up after 5 seconds instead
 * of holding up live traffic queued behind its lock; rerun it when the table is quiet.
 */
export async function migrate(db: Db): Promise<{ applied: number[] }> {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [MIGRATE_LOCK]);
    await tx.query(`SET LOCAL lock_timeout = '5s'`);
    // The baseline's ADD COLUMN IF NOT EXISTS notes every column already there; keep that quiet.
    await tx.query(`SET LOCAL client_min_messages = warning`);
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set(
      (await tx.query<{ version: number }>(`SELECT version FROM schema_migrations`)).map(
        (r) => r.version,
      ),
    );
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) {
        continue;
      }
      await tx.exec(m.sql);
      await tx.query(`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, [
        m.version,
        m.name,
      ]);
      applied.push(m.version);
    }
    return { applied };
  });
}
