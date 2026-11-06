import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { E2E_PGLITE_DIR } from "./env";

/** Rebuilds the e2e database from the seed so every run starts from the same demo data. */
export default function globalSetup(): void {
  rmSync(E2E_PGLITE_DIR, { recursive: true, force: true });
  execFileSync("npm", ["run", "seed"], {
    stdio: "inherit",
    // An empty DATABASE_URL keeps the seed on local PGlite, never a hosted database.
    env: { ...process.env, PGLITE_DIR: E2E_PGLITE_DIR, DATABASE_URL: "" },
  });
}
