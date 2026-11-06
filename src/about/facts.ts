/**
 * Every figure the About and Trust pages state. Numbers that the browser bundle can derive come
 * straight from shared code. The rest live on the server or in Cloudflare config, which the bundle
 * must not import, so they are written here and pinned to their source by
 * `server/trustClaims.test.ts`: change the source and that test fails until this file and
 * docs/security.md agree with it.
 */
import { ACTION_NAMES, OBJECT_TYPES } from "../../shared/schema";
import { MAX_POSSIBLE } from "../../shared/scoreMirror";

export const REPO_URL = "https://github.com/llukehanna/beacon";
export const AUTHOR_URL = "https://lukeghanna.com";
const DOCS_URL = `${REPO_URL}/blob/main/docs`;
export const ARCHITECTURE_DOC_URL = `${DOCS_URL}/architecture.md`;
export const FOUNDRY_DOC_URL = `${DOCS_URL}/foundry-origins.md`;
export const SECURITY_DOC_URL = `${DOCS_URL}/security.md`;
export const EVALS_DOC_URL = `${DOCS_URL}/evals.md`;
export const ERROR_ANALYSIS_DOC_URL = `${DOCS_URL}/error-analysis.md`;

/** Derived from shared code. */
export const OBJECT_TYPE_COUNT = Object.keys(OBJECT_TYPES).length;
export const ACTION_COUNT = ACTION_NAMES.length;
/** Nine axes, each scored 0, 1 or 2. */
export const RUBRIC_MAX = MAX_POSSIBLE;
export const AXIS_COUNT = MAX_POSSIBLE / 2;

/** Pinned to server/seed/universe.ts (UNIVERSE_SIZE). */
export const FIRM_COUNT = 700;

/** Pinned to server/clustering/choose.ts. */
export const CLAUDE_COOLDOWN_MINUTES = 10;
export const CLAUDE_DAILY_MAX = 24;

/** Pinned to wrangler.jsonc ("ratelimits": limit and period, per client IP). */
export const ACTIONS_PER_MINUTE = 60;
export const RESETS_PER_MINUTE = 3;

/** Pinned to api/reset.ts (COOLDOWN_MS) and wrangler.jsonc ("crons"). */
export const RESET_COOLDOWN_MINUTES = 5;
export const NIGHTLY_RESET_UTC = "04:00";

/** Pinned to server/actions/apply.ts, search.ts, params.ts and server/http.ts. */
export const ACTIVITY_ROW_CEILING = 10_000;
export const MANDATE_CEILING = 25;
export const SEARCH_CEILING = 50;
export const MAX_BODY_BYTES = 65_536;

/** Pinned to server/actions/rules.ts (MIN_CLUSTER). */
export const MIN_FIRMS_PER_RULE = 4;

/**
 * Pinned to docs/architecture.md, "Recorded run". The grounding rate says each answer quotes its
 * record faithfully; it is not an accuracy claim about the values.
 */
export const RECORDED_RUN = {
  firms: 700,
  valuesExtracted: 6_472,
  valuesGrounded: 6_455,
  extractionCost: "$1.39",
  clusteringCost: "$0.04",
  model: "Claude Haiku 4.5",
} as const;

/** Pinned, character for character, to public/_headers. */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

/** Pinned to public/_headers and server/http.ts (SECURITY_HEADERS). */
export const OTHER_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Frame-Options", "DENY"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
];
