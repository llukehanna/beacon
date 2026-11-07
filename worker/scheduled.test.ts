import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applyDueSignals = vi.fn(async () => ({ applied: ["s1"], drifts: [] }));
const resetPost = vi.fn(async () => Response.json({ firms: 700 }));

vi.mock("../server/signals/run.js", () => ({ applyDueSignals }));
vi.mock("../api/reset.js", () => ({ POST: resetPost }));
vi.mock("../server/db/migrate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/db/migrate.js")>()),
  schemaVersion: vi.fn(async () => Number.MAX_SAFE_INTEGER),
}));
vi.mock("../server/db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/db/client.js")>()),
  createPgDb: vi.fn(() => ({ close: vi.fn(async () => {}) })),
}));

const { default: worker } = await import("./index.js");
const { HOURLY_CRON, NIGHTLY_CRON } = await import("./crons.js");

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

  it("the 04:00 run resets first, then applies the signals that are due", async () => {
    const order: string[] = [];
    resetPost.mockImplementation(async () => (order.push("reset"), Response.json({ firms: 700 })));
    applyDueSignals.mockImplementationOnce(
      async () => (order.push("signals"), { applied: [], drifts: [] }),
    );
    await worker.scheduled(
      { cron: HOURLY_CRON, scheduledTime: at("2026-11-07T04:00:00Z") },
      env,
      ctx,
    );
    expect(order).toEqual(["reset", "signals"]);
  });

  it("the presenter's nightly-only trigger resets, then applies the signals that are due", async () => {
    await worker.scheduled(
      { cron: NIGHTLY_CRON, scheduledTime: at("2026-11-07T04:00:00Z") },
      env,
      ctx,
    );
    expect(resetPost).toHaveBeenCalledOnce();
    expect(applyDueSignals).toHaveBeenCalledOnce();
  });

  it("applies no signals and fails the run when the nightly reset is refused", async () => {
    resetPost.mockImplementation(async () => Response.json({ error: "too soon" }, { status: 429 }));
    await expect(
      worker.scheduled({ cron: HOURLY_CRON, scheduledTime: at("2026-11-07T04:00:00Z") }, env, ctx),
    ).rejects.toThrow(/Nightly reset failed: 429/);
    expect(applyDueSignals).not.toHaveBeenCalled();
  });

  it("never resets for a trigger it does not know: it only applies the signals that are due", async () => {
    await worker.scheduled(
      { cron: "30 4 * * *", scheduledTime: at("2026-11-07T04:30:00Z") },
      env,
      ctx,
    );
    await worker.scheduled({}, env, ctx);
    expect(resetPost).not.toHaveBeenCalled();
    expect(applyDueSignals).toHaveBeenCalledTimes(2);
  });
});

describe("the Cron Triggers in wrangler.jsonc", () => {
  it("are one per deployment (free plan: five per account): hourly on production, nightly on the presenter", () => {
    const config = readFileSync(resolve(__dirname, "../wrangler.jsonc"), "utf8");
    const lists = config.match(/"crons": \[[^\]]*\]/g) ?? [];
    expect(lists).toEqual([`"crons": ["${HOURLY_CRON}"]`, `"crons": ["${NIGHTLY_CRON}"]`]);
  });
});
