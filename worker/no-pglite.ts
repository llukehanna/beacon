/**
 * Stands in for @electric-sql/pglite in the Worker bundle (see wrangler.jsonc
 * "alias"). The Worker always uses DATABASE_URL, and the PGlite WASM build
 * would not fit the free plan's 3 MB script limit.
 */
export class PGlite {
  constructor() {
    throw new Error("PGlite is not available in the Worker; set DATABASE_URL");
  }
}
