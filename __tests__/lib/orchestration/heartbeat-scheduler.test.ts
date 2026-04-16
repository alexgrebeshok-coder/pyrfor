import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cronMatchesNow,
  enqueueScheduledHeartbeatWakeups,
  processHeartbeatQueue,
} from "@/lib/orchestration/heartbeat-scheduler";

function createPrismaMock() {
  return {
    agentWakeupRequest: {
      findMany: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    heartbeatRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
    agent: {
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("heartbeat scheduler", () => {
  const prisma = createPrismaMock();
  const fetchImpl = vi.fn();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.agentWakeupRequest.findMany.mockResolvedValue([]);
    prisma.agentWakeupRequest.update.mockResolvedValue({ id: "wakeup-1" });
    prisma.agentWakeupRequest.findFirst.mockResolvedValue(null);
    prisma.agentWakeupRequest.create.mockResolvedValue({ id: "wakeup-created" });
    prisma.heartbeatRun.create.mockResolvedValue({ id: "run-1" });
    prisma.heartbeatRun.update.mockResolvedValue({ id: "run-1" });
    prisma.agent.update.mockResolvedValue({ id: "agent-1" });
    prisma.agent.findMany.mockResolvedValue([]);
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("matches cron expressions with steps and ranges", () => {
    const now = new Date(2026, 3, 16, 10, 30, 0);

    expect(cronMatchesNow("*/5 * * * *", now)).toBe(true);
    expect(cronMatchesNow("30 10 * * *", now)).toBe(true);
    expect(cronMatchesNow("0 9 * * *", now)).toBe(false);
    expect(cronMatchesNow("15-45/5 10 * * *", now)).toBe(true);
  });

  it("skips paused agents when draining the queue", async () => {
    prisma.agentWakeupRequest.findMany.mockResolvedValue([
      {
        id: "wakeup-1",
        agentId: "agent-1",
        reason: "user",
        triggerData: "{}",
        status: "queued",
        createdAt: new Date("2026-04-16T10:00:00.000Z"),
        processedAt: null,
        agent: {
          workspaceId: "workspace-1",
          status: "paused",
        },
      },
    ]);

    const result = await processHeartbeatQueue({ prisma, fetchImpl, logger });

    expect(result).toEqual({
      queued: 1,
      processed: 0,
      failed: 0,
      skipped: 1,
    });
    expect(prisma.agentWakeupRequest.update).toHaveBeenCalledWith({
      where: { id: "wakeup-1" },
      data: { status: "skipped", processedAt: expect.any(Date) },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a run and posts to the execute endpoint for active agents", async () => {
    prisma.agentWakeupRequest.findMany.mockResolvedValue([
      {
        id: "wakeup-1",
        agentId: "agent-1",
        reason: "cron",
        triggerData: '{"task":"Check budget variance"}',
        status: "queued",
        createdAt: new Date("2026-04-16T10:00:00.000Z"),
        processedAt: null,
        agent: {
          workspaceId: "workspace-1",
          status: "idle",
        },
      },
    ]);

    const result = await processHeartbeatQueue(
      { prisma, fetchImpl, logger },
      { gatewayPort: 4010 }
    );

    expect(result.processed).toBe(1);
    expect(prisma.heartbeatRun.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        wakeupRequestId: "wakeup-1",
        status: "queued",
        invocationSource: "cron",
        contextSnapshot: '{"task":"Check budget variance"}',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4010/api/orchestration/heartbeat/execute",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run-1",
          agentId: "agent-1",
          workspaceId: "workspace-1",
          wakeupRequestId: "wakeup-1",
          task: "Check budget variance",
        }),
      })
    );
  });

  it("marks the wakeup and run as failed when the HTTP trigger fails", async () => {
    prisma.agentWakeupRequest.findMany.mockResolvedValue([
      {
        id: "wakeup-1",
        agentId: "agent-1",
        reason: "user",
        triggerData: "{}",
        status: "queued",
        createdAt: new Date("2026-04-16T10:00:00.000Z"),
        processedAt: null,
        agent: {
          workspaceId: "workspace-1",
          status: "idle",
        },
      },
    ]);
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 500 }));

    const result = await processHeartbeatQueue({ prisma, fetchImpl, logger });

    expect(result.failed).toBe(1);
    expect(prisma.heartbeatRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        status: "failed",
        finishedAt: expect.any(Date),
        resultJson: JSON.stringify({ error: "Daemon HTTP trigger failed" }),
      },
    });
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: "agent-1" },
      data: { status: "error" },
    });
    expect(prisma.agentWakeupRequest.update).toHaveBeenLastCalledWith({
      where: { id: "wakeup-1" },
      data: { status: "failed", processedAt: expect.any(Date) },
    });
  });

  it("enqueues scheduled wakeups only for matching agents without recent duplicates", async () => {
    prisma.agent.findMany.mockResolvedValue([
      {
        id: "agent-1",
        workspaceId: "workspace-1",
        runtimeConfig: '{"schedule":"*/2 * * * *"}',
        slug: "ops-agent",
      },
      {
        id: "agent-2",
        workspaceId: "workspace-1",
        runtimeConfig: '{"schedule":"15 8 * * *"}',
        slug: "finance-agent",
      },
    ]);
    prisma.agentWakeupRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "recent-1" });

    const result = await enqueueScheduledHeartbeatWakeups(
      {
        prisma,
        logger,
        now: new Date(2026, 3, 16, 10, 30, 0),
      },
      { duplicateWindowMs: 10 * 60 * 1000 }
    );

    expect(result).toEqual({
      checked: 2,
      enqueued: 1,
    });
    expect(prisma.agentWakeupRequest.create).toHaveBeenCalledWith({
      data: {
        agentId: "agent-1",
        reason: "cron",
        triggerData: JSON.stringify({ schedule: "*/2 * * * *" }),
        status: "queued",
      },
    });
  });
});
