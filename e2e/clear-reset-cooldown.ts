import { getDb } from "../server/db/client";

// Seeding stamps the reset cooldown, which would make the Reset button answer "try again
// shortly" for the first five minutes. The e2e database is the tests' own, so clear it.
const db = await getDb();
await db.query(`DELETE FROM meta WHERE key = 'lastResetAt'`);
await db.close();
