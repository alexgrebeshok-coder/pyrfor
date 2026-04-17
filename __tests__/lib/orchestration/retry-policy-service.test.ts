import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyWakeupFailure,
  buildWakeupIdempotencyKey,
  classifyOrchestrationFailure,
} from "@/lib/orchestration/retry-policy-service";

function createPrismaMock() {
  return {
    agentWakeupRequest: {
      update: vi.fn(),
    },
    deadLetterJob: {
      create: vi.fn(),
    },
  };
}

describe("retry policy service", () => {
  const prisma = createPrismaMock();

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.agentWakeupRequest.update.mockResolvedValue({ id: "wakeup-1" });
    prisma.deadLetterJob.create.mockResolvedValue({ id: "dlq-1" });
  });

  it("builds stable idempotency keys for the same wakeup payload", () => {
    const now = new Date("2026-04-16T18:00:00.000Z");
    const first = buildWakeupIdempotencyKey({
      agentId: "agent-1",
      reason: "user",
      triggerData: { task: "Check budget", nested: { b: 2, a: 1 } },
      scope: "manual",
      now,
      bucketMs: 30_000,
    });
    const second = buildWakeupIdempotencyKey({
      agentId: "agent-1",
      reason: "user",
      triggerData: { nested: { a: 1, b: 2 }, task: "Check budget" },
      scope: "manual",
      now,
      bucketMs: 30_000,
    });

    expect(first).toBe(second);
  });

  it("classifies budget failures as non-retryable", () => {
    expect(classifyOrchestrationFailure(new Error("Monthly budget exceeded"))).toEqual({
      errorType: "budget_exceeded",
      message: "Monthly budget exceeded",
      retryable: false,
    });
  });

  it("requeues retryable failures with exponential backoff", async () => {
    const decision = await applyWakeupFailure({
      wakeupRequest: {
        id: "wakeup-1",
        agentId: "agent-1",
        reason: "cron",
        triggerData: '{"task":"Check budget"}',
        retryCount: 1,
        maxRetries: 3,
        idempotencyKey: "scheduled:agent-1:1:abc",
      },
      workspaceId: "workspace-1",
      error: new Error("Gateway timeout while contacting adapter"),
      prismaClient: prisma,
    });

    expect(decision.kind).toBe("requeue");
    expect(decision.classification.errorType).toBe("timeout");
    expect(decision.nextRetryAt).toBeInstanceOf(Date);
    expect(prisma.agentWakeupRequest.update).toHaveBeenCalledWith({
      where: { id: "wakeup-1" },
      data: expect.objectContaining({
        status: "queued",
        retryCount: 2,
        lastErrorType: "timeout",
        processedAt: null,
      }),
    });
    expect(prisma.deadLetterJob.create).not.toHaveBeenCalled();
  });

  it("moves terminal failures into the dead-letter queue", async () => {
    const decision = await applyWakeupFailure({
      wakeupRequest: {
        id: "wakeup-2",
        agentId: "agent-2",
        reason: "user",
        triggerData: '{"task":"Generate report"}',
        retryCount: 0,
        maxRetries: 3,
        idempotencyKey: null,
      },
      workspaceId: "workspace-1",
      runId: "run-2",
      error: new Error("Monthly budget exceeded"),
      prismaClient: prisma,
    });

    expect(decision.kind).toBe("dead_letter");
    expect(prisma.deadLetterJob.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace-1",
        agentId: "agent-2",
        wakeupRequestId: "wakeup-2",
        runId: "run-2",
        reason: "user",
        errorType: "budget_exceeded",
        errorMessage: "Monthly budget exceeded",
        payloadJson: '{"task":"Generate report"}',
        attempts: 0,
        status: "open",
      },
    });
    expect(prisma.agentWakeupRequest.update).toHaveBeenCalledWith({
      where: { id: "wakeup-2" },
      data: expect.objectContaining({
        status: "failed",
        lastErrorType: "budget_exceeded",
        processedAt: expect.any(Date),
      }),
    });
  });
});
