import { json } from "../server/http.js";

/** The Workers Rate Limiting binding (wrangler.jsonc "ratelimits"). */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Returns a 429 JSON response when `limiter` refuses this client, else null.
 * Keyed by client IP; with no binding (local dev, tests) nothing is limited.
 */
export async function checkRate(
  limiter: RateLimit | undefined,
  request: Request,
): Promise<Response | null> {
  if (!limiter) {
    return null;
  }
  const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await limiter.limit({ key });
  if (success) {
    return null;
  }
  const res = json({ error: "Too many requests. Try again in a minute." }, 429);
  res.headers.set("retry-after", "60");
  return res;
}
