import { createPgDb } from "../server/db/client.js";
import { LATEST_MIGRATION, migrate, schemaVersion } from "../server/db/migrate.js";

// Applies the numbered migrations in server/db/migrations to the database DATABASE_URL points at.
// Run it before deploying a build that needs a newer schema (the Reseed workflow with mode
// migrate does the same). Safe to rerun: it applies only what is missing.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to the Postgres connection string to migrate.");
  process.exit(1);
}
const db = createPgDb(url);
try {
  const before = await schemaVersion(db);
  const { applied } = await migrate(db);
  console.log(
    applied.length === 0
      ? `Schema already at version ${LATEST_MIGRATION}; nothing to apply.`
      : `Schema migrated from version ${before} to ${LATEST_MIGRATION} (applied ${applied.join(", ")}).`,
  );
  if (applied.length > 0 && (await db.query(`SELECT to_regclass('migration_repair') AS t`))[0].t) {
    // 0003 repairs rows that would break its constraints and logs each one.
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM migration_repair WHERE "version" = ANY($1::int[])`,
      [applied],
    );
    if (n > 0) {
      console.log(
        `${n} row${n === 1 ? " was" : "s were"} repaired to fit the new constraints. Review them: SELECT * FROM migration_repair ORDER BY "repairId";`,
      );
    }
  }
} finally {
  await db.close();
}
