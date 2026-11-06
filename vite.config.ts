import react from "@vitejs/plugin-react";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import { devApi } from "./server/dev/vitePlugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: { port: 8080 },
  // Each server test boots a fresh in-memory PGlite; under a full parallel run that alone can pass 5 s.
  // The same boot happens in beforeAll hooks, which otherwise stop at the 10 s hook default.
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
