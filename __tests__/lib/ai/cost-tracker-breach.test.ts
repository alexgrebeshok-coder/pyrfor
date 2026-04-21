/**
 * Budget-breach detection tests for `lib/ai/cost-tracker.ts`.
 *
 * We stub the Prisma module so `getDailyCostPosture` returns controlled
 * totals, and the agent bus so we can observe `budget.alert` events
 * without touching the real singleton.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  create: vi.fn().mockResolvedValue({}),
  publish: vi.fn().mockResolvedValue({}),
  recent: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aIRunCost: {
      aggregate: mocks.aggregate,
      create: mocks.create,
    },
  },
}));

vi.mock("@/lib/ai/messaging/agent-bus", () => ({
  agentBus: {
    publish: mocks.publish,
    recent: mocks.recent,
  },
}));

async function loadCostTracker() {
  vi.resetModules();
  return (await import("@/lib/ai/cost-tracker")) as typeof import("@/lib/ai/cost-tracker");
}

describe("cost-tracker budget breach detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_DAILY_COST_LIMIT = "10";
  });

  afterEach(() => {
    delete process.env.AI_DAILY_COST_LIMIT;
  });

  it("does not publish an alert below the warning threshold", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { costUsd: 5 },
      _count: { _all: 10 },
    });
    const tracker = await loadCostTracker();
    tracker.__resetBudgetAlertCacheForTests();

    await tracker.trackCost({
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.5,
      costRub: 45,
      workspaceId: "ws-a",
      runId: "run-1",
    });

    // Let the fire-and-forget hook run.
    await new Promise((r) => setImmediate(r));
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("publishes a 'warning' budget.alert at 80% utilisation", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { costUsd: 8.5 },
      _count: { _all: 50 },
    });
    const tracker = await loadCostTracker();
    tracker.__resetBudgetAlertCacheForTests();

    await tracker.trackCost({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.5,
      costRub: 45,
      workspaceId: "ws-b",
      runId: "run-2",
    });

    await new Promise((r) => setImmediate(r));
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith(
      "budget.alert",
      expect.objectContaining({
        workspaceId: "ws-b",
        severity: "warning",
        threshold: 0.8,
      }),
      expect.objectContaining({ source: "cost-tracker", workspaceId: "ws-b" })
    );
  });

  it("publishes both warning and breach alerts when utilisation crosses 100%", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { costUsd: 12 },
      _count: { _all: 100 },
    });
    const tracker = await loadCostTracker();
    tracker.__resetBudgetAlertCacheForTests();

    await tracker.trackCost({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 2,
      costRub: 180,
      workspaceId: "ws-c",
      runId: "run-3",
    });

    await new Promise((r) => setImmediate(r));
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    const severities = mocks.publish.mock.calls.map(
      (c) => (c[1] as { severity: string }).severity
    );
    expect(severities).toContain("warning");
    expect(severities).toContain("breach");
  });

  it("does not re-emit the same threshold on the same day", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { costUsd: 9 },
      _count: { _all: 50 },
    });
    const tracker = await loadCostTracker();
    tracker.__resetBudgetAlertCacheForTests();

    const record = {
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.1,
      costRub: 9,
      workspaceId: "ws-d",
      runId: "run-4",
    };

    await tracker.trackCost(record);
    await tracker.trackCost(record);
    await tracker.trackCost(record);

    await new Promise((r) => setImmediate(r));
    // Only the first one of each severity should have fired — in this case
    // only the "warning" threshold, because utilisation is 90%.
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("skips breach detection entirely when workspaceId is missing", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { costUsd: 100 },
      _count: { _all: 100 },
    });
    const tracker = await loadCostTracker();
    tracker.__resetBudgetAlertCacheForTests();

    await tracker.trackCost({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.1,
      costRub: 9,
    });

    await new Promise((r) => setImmediate(r));
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("getRecentBudgetAlerts filters bus messages to the given workspace", async () => {
    mocks.recent.mockReturnValue([
      {
        type: "budget.alert",
        payload: { workspaceId: "ws-a", severity: "warning", threshold: 0.8 },
      },
      {
        type: "budget.alert",
        payload: { workspaceId: "ws-a", severity: "breach", threshold: 1.0 },
      },
    ]);
    const tracker = await loadCostTracker();

    const alerts = tracker.getRecentBudgetAlerts("ws-a", 10);
    expect(alerts).toHaveLength(2);
    expect(mocks.recent).toHaveBeenCalledWith({
      type: "budget.alert",
      workspaceId: "ws-a",
      limit: 10,
    });
  });
});
