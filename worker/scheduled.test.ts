import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applyDueSignals = vi.fn(async () => ({ applied: ["s1"], drifts: [] }));
const resetPost = vi.fn(async () => Response.json({ firms: 700 }));

vi.mock("../server/signals/run.js", () => ({ applyDueSignals }));
vi.mock("../api/reset.js", () => ({ POST: resetPost }));
vi.mock("../server/db/ddl.js", () => ({ ensureSchema: vi.fn(async () => {}) }));
vi.mock("../server/db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/db/client.js")>()),
  createPgDb: vi.fn(() => ({ close: vi.fn(async () => {}) })),
}));

const { default: worker, HOURLY_CRON, NIGHTLY_CRON } = await import("./index.js");

const env = { ASSETS: { fetch: vi.fn() }, HYPERDRIVE: { connectionString: "postgres://test" } };
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
const at = (iso: string) => Date.parse(iso);

beforeEach(() => {
  applyDueSignals.mockClear();
  resetPost.mockClear();
  resetPost.mockImplementation(async () => Response.json({ firms: 700 }));
});

describe("worker scheduled", () => {
  it("the hourly trigger only applies the signals that are due", async () => {
    await worker.scheduled(
      { cron: HOURLY_CRON, scheduledTime: at("2026-11-07T09:00:00Z") },
      env,
      ctx,
    );
    expect(applyDueSignals).toHaveBeenCalledOnce();
    expect(resetPost).not.toHaveBeenCalled();
  });

  it("the hourly trigger stands down at 04:00, when the nightly one resets and applies", async () => {
    await worker.scheduled(
      { cron: HOURLY_CRON, scheduledTime: at("2026-11-07T04:00:00Z") },
      env,
      ctx,
    );
    expect(applyDueSignals).not.toHaveBeenCalled();
    expect(resetPost).not.toHaveBeenCalled();
  });

  it("the nightly trigger resets first, then applies the signals that are due", async () => {
    const order: string[] = [];
    resetPost.mockImplementation(async () => (order.push("reset"), Response.json({ firms: 700 })));
    applyDueSignals.mockImplementationOnce(
      async () => (order.push("signals"), { applied: [], drifts: [] }),
    );
    await worker.scheduled(
      { cron: NIGHTLY_CRON, scheduledTime: at("2026-11-07T04:00:00Z") },
      env,
      ctx,
    );
    expect(order).toEqual(["reset", "signals"]);
  });

  it("applies no signals and fails the run when the nightly reset is refused", async () => {
    resetPost.mockImplementation(async () => Response.json({ error: "too soon" }, { status: 429 }));
    await expect(
      worker.scheduled({ cron: NIGHTLY_CRON, scheduledTime: at("2026-11-07T04:00:00Z") }, env, ctx),
    ).rejects.toThrow(/Nightly reset failed: 429/);
    expect(applyDueSignals).not.toHaveBeenCalled();
  });

  it("treats a trigger it does not know as the nightly one", async () => {
    await worker.scheduled({}, env, ctx);
    expect(resetPost).toHaveBeenCalledOnce();
    expect(applyDueSignals).toHaveBeenCalledOnce();
  });
});

describe("the Cron Triggers in wrangler.jsonc", () => {
  it("are the nightly reset and the hourly signals run, on production and the presenter deployment", () => {
    const config = readFileSync(resolve(__dirname, "../wrangler.jsonc"), "utf8");
    const lists = config.match(/"crons": \[[^\]]*\]/g) ?? [];
    expect(lists).toEqual([
      `"crons": ["${NIGHTLY_CRON}", "${HOURLY_CRON}"]`,
      `"crons": ["${NIGHTLY_CRON}", "${HOURLY_CRON}"]`,
    ]);
  });
});
