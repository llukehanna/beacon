import { defineConfig, devices } from "@playwright/test";
import { E2E_PGLITE_DIR, PORT } from "./e2e/env";

// Every run uses its own database: global setup rebuilds it, and the dev server reads the same
// directory through PGLITE_DIR. Nothing here touches .data/pglite or the hosted reset endpoint.

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The desk tests mutate the shared database and depend on file order, so run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Kept apart from test-results/shots so a run does not delete the screenshots.
  outputDir: "test-results/artifacts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite",
    url: `http://localhost:${PORT}`,
    // A server left running would be pointed at some other database.
    reuseExistingServer: false,
    timeout: 120_000,
    // The database opens on the first /api request, which comes after global setup has seeded it.
    env: { PGLITE_DIR: E2E_PGLITE_DIR, DATABASE_URL: "" },
  },
});
