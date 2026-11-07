import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { percentiles } from "../../shared/operations.js";
import { NO_WALL } from "../access.js";
import { applyAction } from "../actions/apply.js";
import { createClaudeClusterer, modelCallOf } from "../clustering/claude.js";
import { operationsSummary } from "../functions/operationsSummary.js";
import { resetDemo } from "../seed/reset.js";
import { resetFromSnapshot, saveSnapshot } from "../seed/snapshot.js";
import { createTestDb } from "../testing.js";
import { MAX_ACTION_RUNS, recordActionRun, recordModelCall } from "./record.js";

const NOW = new Date("2026-11-06T12:00:00.000Z");

afterEach(() => vi.restoreAllMocks());

const count = async (db: Awaited<ReturnType<typeof createTestDb>>, table: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

describe("ActionRun recording", () => {
  it("records one run per action with its name, duration and outcome", async () => {
    const db = await createTestDb();
    await applyAction(db, "clusterRejections", {}, { now: NOW, access: NO_WALL });
    const rows = await db.query<{
      actionName: string;
      ok: boolean;
      durationMs: number;
      errorKind: string | null;
    }>(`SELECT * FROM action_run`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionName: "clusterRejections", ok: true, errorKind: null });
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records a rejected action as an error, and an unknown action not at all", async () => {
    const db = await createTestDb();
    await expect(
      applyAction(db, "rejectFirm", {}, { now: NOW, access: NO_WALL }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      applyAction(db, "dropTables", {}, { now: NOW, access: NO_WALL }),
    ).rejects.toMatchObject({
      status: 404,
    });
    const rows = await db.query<{ actionName: string; ok: boolean; errorKind: string }>(
      `SELECT "actionName", "ok", "errorKind" FROM action_run`,
    );
    expect(rows).toEqual([{ actionName: "rejectFirm", ok: false, errorKind: "http_400" }]);
  });

  it("action succeeds when metric write fails", async () => {
    const db = await createTestDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const withMetrics = await applyAction(
      db,
      "clusterRejections",
      {},
      { now: NOW, access: NO_WALL },
    );
    const failing = await applyAction(
      db,
      "clusterRejections",
      {},
      {
        now: NOW,
        access: NO_WALL,
        recordRun: () => Promise.reject(new Error("metrics store is down")),
      },
    );
    expect(failing).toEqual(withMetrics);
    expect(warn).toHaveBeenCalledOnce();
    // A recorder that throws synchronously is no different.
    await expect(
      applyAction(
        db,
        "clusterRejections",
        {},
        {
          now: NOW,
          access: NO_WALL,
          recordRun: () => {
            throw new Error("boom");
          },
        },
      ),
    ).resolves.toEqual(withMetrics);
  });

  it("keeps the original error when an action fails and the metric write fails too", async () => {
    const db = await createTestDb();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      applyAction(
        db,
        "rejectFirm",
        {},
        {
          now: NOW,
          access: NO_WALL,
          recordRun: () => Promise.reject(new Error("metrics store is down")),
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stops storing runs at the ceiling", async () => {
    const db = await createTestDb();
    await db.query(
      `INSERT INTO action_run ("actionRunId", "actionName", "startedAt", "durationMs", "ok")
       SELECT 'r' || g, 'rejectFirm', now(), 5, true FROM generate_series(1, ${MAX_ACTION_RUNS}) g`,
    );
    await recordActionRun(db, {
      actionName: "rejectFirm",
      startedAt: NOW,
      durationMs: 5,
      ok: true,
    });
    expect(await count(db, "action_run")).toBe(MAX_ACTION_RUNS);
  });
});

describe("ModelCall recording", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_input_tokens: 500,
    cache_creation_input_tokens: 100,
  };

  it("prices the reported tokens with the pricing module's rates", () => {
    const call = modelCallOf({ model: "claude-opus-5", usage }, NOW)!;
    // 1000 in at $5, 200 out at $25, 500 cached reads at $0.5, 100 cache writes at $6.25, per million.
    expect(call.costUsd).toBeCloseTo((1000 * 5 + 200 * 25 + 500 * 0.5 + 100 * 6.25) / 1e6, 10);
    expect(call).toMatchObject({
      purpose: "clustering",
      model: "claude-opus-5",
      inputTokens: 1600,
      outputTokens: 200,
      calledAt: NOW,
    });
  });

  it("has nothing to record without usage, and prices an unlisted model as the clustering model", () => {
    expect(modelCallOf({ model: "claude-opus-5" }, NOW)).toBeNull();
    const unlisted = modelCallOf({ model: "claude-future-9", usage }, NOW)!;
    expect(unlisted.model).toBe("claude-future-9");
    expect(unlisted.costUsd).toBeCloseTo(
      modelCallOf({ model: "claude-opus-5", usage }, NOW)!.costUsd,
      10,
    );
  });

  const client = (text: string, withUsage = true) =>
    ({
      beta: {
        messages: {
          create: vi.fn(async () => ({
            model: "claude-opus-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text }],
            ...(withUsage ? { usage } : {}),
          })),
        },
      },
    }) as unknown as Anthropic;
  const rows = [{ decisionId: "d1", firmId: "f1", rationale: "Too small.", firm: {} }];

  it("records a live call, also when its reply turns out unusable", async () => {
    const db = await createTestDb();
    const onCall = (call: Parameters<typeof recordModelCall>[1]) => recordModelCall(db, call);
    await createClaudeClusterer(client(JSON.stringify({ rules: [] })), onCall)(rows);
    await expect(createClaudeClusterer(client("not json"), onCall)(rows)).rejects.toThrow();
    const stored = await db.query<{ inputTokens: number; costUsd: number }>(
      `SELECT "inputTokens", "costUsd" FROM model_call`,
    );
    expect(stored).toHaveLength(2);
    expect(stored[0].inputTokens).toBe(1600);
    expect(stored[0].costUsd).toBeGreaterThan(0);
  });

  it("does not let a failed metric write change the clustering result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await createClaudeClusterer(client(JSON.stringify({ rules: [] })), () =>
      Promise.reject(new Error("down")),
    )(rows);
    expect(out).toEqual({ proposals: [], source: "claude" });
  });
});

describe("operationsSummary", () => {
  it("reports per-action counts and latency, spend per UTC day, and the window start", async () => {
    const db = await createTestDb();
    await resetDemo(db, NOW);
    // The seeded history is built through actions but is not a measurement of the running app.
    expect(await count(db, "action_run")).toBe(0);

    await applyAction(db, "clusterRejections", {}, { now: NOW, access: NO_WALL });
    await applyAction(db, "clusterRejections", {}, { now: NOW, access: NO_WALL });
    await expect(
      applyAction(db, "rejectFirm", {}, { now: NOW, access: NO_WALL }),
    ).rejects.toThrow();
    for (const [calledAt, cost] of [
      ["2026-11-06T01:00:00Z", 0.25],
      ["2026-11-06T23:59:00Z", 0.5],
      ["2026-11-05T12:00:00Z", 0.1],
    ] as const) {
      await recordModelCall(db, {
        purpose: "clustering",
        model: "claude-opus-5",
        inputTokens: 1000,
        outputTokens: 100,
        costUsd: cost,
        calledAt: new Date(calledAt),
      });
    }

    const summary = await operationsSummary(db);
    expect(summary.windowStart).toBe(NOW.toISOString());
    const cluster = summary.actions.find((a) => a.actionName === "clusterRejections")!;
    expect(cluster.count).toBe(2);
    expect(cluster.errors).toBe(0);
    expect(cluster.p50Ms).toBeGreaterThanOrEqual(0);
    expect(cluster.p95Ms).toBeGreaterThanOrEqual(cluster.p50Ms);
    expect(summary.actions.find((a) => a.actionName === "rejectFirm")).toMatchObject({
      count: 1,
      errors: 1,
    });
    expect(summary.spend).toEqual([
      { day: "2026-11-06", calls: 2, inputTokens: 2000, outputTokens: 200, costUsd: 0.75 },
      { day: "2026-11-05", calls: 1, inputTokens: 1000, outputTokens: 100, costUsd: 0.1 },
    ]);
    expect(summary.dailyCallCap).toBe(24);
  }, 60_000);

  it("computes the same p50 and p95 in SQL as the nearest-rank definition, at every run count", async () => {
    const db = await createTestDb();
    // Run counts either side of the points where nearest rank changes (19/20 for p95, odd and even for p50).
    const sizes: Record<string, number> = {
      qualifyFirm: 1,
      rejectFirm: 2,
      advanceStage: 19,
      verifyFinding: 20,
      enrichFirm: 21,
      runSearch: 100,
      approveRule: 101,
      dismissRule: 997,
    };
    const durations = new Map<string, number[]>();
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const values: string[] = [];
    for (const [name, n] of Object.entries(sizes)) {
      const ds = Array.from({ length: n }, () => rand() % 400);
      durations.set(name, ds);
      ds.forEach((d, i) => values.push(`('${name}-${i}', '${name}', now(), ${d}, ${i % 7 !== 0})`));
    }
    await db.query(
      `INSERT INTO action_run ("actionRunId", "actionName", "startedAt", "durationMs", "ok") VALUES ${values.join(", ")}`,
    );

    const { actions } = await operationsSummary(db);
    expect(actions).toHaveLength(Object.keys(sizes).length);
    for (const a of actions) {
      const ds = durations.get(a.actionName)!;
      const want = percentiles(ds)!;
      expect({ p50: a.p50Ms, p95: a.p95Ms }, a.actionName).toEqual(want);
      expect(a.count, a.actionName).toBe(ds.length);
      expect(a.errors, a.actionName).toBe(Math.ceil(ds.length / 7));
    }
    // Busiest first, ties by name.
    expect(actions.map((a) => a.count)).toEqual(
      [...actions.map((a) => a.count)].sort((x, y) => y - x),
    );
  }, 60_000);

  it("starts a new window at each reset: the metrics are cleared, not snapshotted", async () => {
    const db = await createTestDb();
    await resetDemo(db, NOW);
    await saveSnapshot(db, NOW);
    await applyAction(db, "clusterRejections", {}, { now: NOW, access: NO_WALL });
    await recordModelCall(db, {
      purpose: "clustering",
      model: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.01,
      calledAt: NOW,
    });
    const later = new Date(NOW.getTime() + 3_600_000);
    await resetFromSnapshot(db, later);
    expect(await count(db, "action_run")).toBe(0);
    expect(await count(db, "model_call")).toBe(0);
    expect((await operationsSummary(db)).windowStart).toBe(later.toISOString());
  }, 120_000);
});
