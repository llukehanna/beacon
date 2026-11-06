import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { E2E_PGLITE_DIR } from "./env";

/** Rebuilds the e2e database from the seed so every run starts from the same demo data. */
export default function globalSetup(): void {
  rmSync(E2E_PGLITE_DIR, { recursive: true, force: true });
  // An empty DATABASE_URL keeps both steps on local PGlite, never a hosted database.
  const env = { ...process.env, PGLITE_DIR: E2E_PGLITE_DIR, DATABASE_URL: "" };
  execFileSync("npm", ["run", "seed"], { stdio: "inherit", env });
  execFileSync("npx", ["tsx", "e2e/clear-reset-cooldown.ts"], { stdio: "inherit", env });
}
