import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    agentWakeupRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { jobQueue } from "@/lib/orchestration/job-queue";

describe("job queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.agentWakeupRequest.findFirst.mockResolvedValue(null);
    mocks.prisma.agentWakeupRequest.create.mockResolvedValue({
      id: "wakeup-1",
      agentId: "agent-1",
      reason: "user",
      triggerData: '{"task":"Ping"}',
      status: "queued",
      retryCount: 0,
      maxRetries: 3,
      idempotencyKey: "manual:agent-1:1:abcd",
      createdAt: new Date("2026-04-16T18:00:00.000Z"),
    });
  });

  it("enqueues a new wakeup with idempotency metadata", async () => {
    const job = await jobQueue.enqueue({
      agentId: "agent-1",
      reason: "user",
      triggerData: { task: "Ping" },
      idempotencyKey: "manual:agent-1:1:abcd",
      maxRetries: 3,
    });

    expect(job).toEqual({
      id: "wakeup-1",
      agentId: "agent-1",
      reason: "user",
      triggerData: { task: "Ping" },
      status: "queued",
      retryCount: 0,
      maxRetries: 3,
      idempotencyKey: "manual:agent-1:1:abcd",
      createdAt: new Date("2026-04-16T18:00:00.000Z"),
    });
    expect(mocks.prisma.agentWakeupRequest.create).toHaveBeenCalledWith({
      data: {
        agentId: "agent-1",
        reason: "user",
        triggerData: '{"task":"Ping"}',
        idempotencyKey: "manual:agent-1:1:abcd",
        maxRetries: 3,
      },
    });
  });

  it("returns the existing queued wakeup for the same idempotency key", async () => {
    mocks.prisma.agentWakeupRequest.findFirst.mockResolvedValue({
      id: "wakeup-existing",
      agentId: "agent-1",
      reason: "user",
      triggerData: '{"task":"Ping"}',
      status: "queued",
      retryCount: 1,
      maxRetries: 3,
      idempotencyKey: "manual:agent-1:1:abcd",
      createdAt: new Date("2026-04-16T18:00:00.000Z"),
    });

    const job = await jobQueue.enqueue({
      agentId: "agent-1",
      reason: "user",
      triggerData: { task: "Ping" },
      idempotencyKey: "manual:agent-1:1:abcd",
      maxRetries: 3,
    });

    expect(job.id).toBe("wakeup-existing");
    expect(mocks.prisma.agentWakeupRequest.create).not.toHaveBeenCalled();
  });
});
