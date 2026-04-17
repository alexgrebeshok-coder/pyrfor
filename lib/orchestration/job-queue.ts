// Job Queue Abstraction
// MVP: simple DB-backed queue via AgentWakeupRequest
// Future: swap to BullMQ/Inngest without changing callers

import { prisma } from "@/lib/prisma";
import type { WakeupReason } from "./types";

export interface JobPayload {
  agentId: string;
  reason: WakeupReason;
  triggerData?: Record<string, unknown>;
  idempotencyKey?: string;
  maxRetries?: number;
}

export interface Job {
  id: string;
  agentId: string;
  reason: string;
  triggerData: Record<string, unknown>;
  status: string;
  retryCount: number;
  maxRetries: number;
  idempotencyKey: string | null;
  createdAt: Date;
}

// ── Queue Interface (swap implementation later) ─────────────

export interface IJobQueue {
  enqueue(payload: JobPayload): Promise<Job>;
  dequeueNext(): Promise<Job | null>;
  markDone(jobId: string): Promise<void>;
  markFailed(jobId: string): Promise<void>;
  getPending(agentId?: string): Promise<Job[]>;
}

// ── DB-backed implementation ────────────────────────────────

class PrismaJobQueue implements IJobQueue {
  async enqueue(payload: JobPayload): Promise<Job> {
    const triggerData = payload.triggerData
      ? JSON.stringify(payload.triggerData)
      : "{}";
    const existing = await prisma.agentWakeupRequest.findFirst({
      where: payload.idempotencyKey
        ? {
            agentId: payload.agentId,
            idempotencyKey: payload.idempotencyKey,
            status: { in: ["queued", "processing"] },
          }
        : {
            agentId: payload.agentId,
            reason: payload.reason,
            status: "queued",
          },
    });
    if (existing) {
      return this.toJob(existing);
    }

    const row = await prisma.agentWakeupRequest.create({
      data: {
        agentId: payload.agentId,
        reason: payload.reason,
        triggerData,
        idempotencyKey: payload.idempotencyKey,
        maxRetries: payload.maxRetries ?? 3,
      },
    });
    return this.toJob(row);
  }

  async dequeueNext(): Promise<Job | null> {
    const row = await prisma.agentWakeupRequest.findFirst({
      where: {
        status: "queued",
        availableAt: { lte: new Date() },
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!row) return null;

    // Mark as processing (optimistic lock via status check)
    const updated = await prisma.agentWakeupRequest.updateMany({
      where: {
        id: row.id,
        status: "queued",
        availableAt: { lte: new Date() },
      },
      data: { status: "processing" },
    });
    if (updated.count === 0) return null; // someone else grabbed it

    return this.toJob({ ...row, status: "processing" });
  }

  async markDone(jobId: string): Promise<void> {
    await prisma.agentWakeupRequest.update({
      where: { id: jobId },
      data: { status: "processed", processedAt: new Date() },
    });
  }

  async markFailed(jobId: string): Promise<void> {
    await prisma.agentWakeupRequest.update({
      where: { id: jobId },
      data: { status: "failed", processedAt: new Date() },
    });
  }

  async getPending(agentId?: string): Promise<Job[]> {
    const where: Record<string, unknown> = {
      status: { in: ["queued", "processing"] },
    };
    if (agentId) where.agentId = agentId;

    const rows = await prisma.agentWakeupRequest.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(this.toJob);
  }

  private toJob(row: {
    id: string;
    agentId: string;
    reason: string;
    triggerData: string;
    status: string;
    retryCount: number;
    maxRetries: number;
    idempotencyKey: string | null;
    createdAt: Date;
  }): Job {
    let triggerData: Record<string, unknown> = {};
    try {
      triggerData = JSON.parse(row.triggerData);
    } catch {}
    return {
      id: row.id,
      agentId: row.agentId,
      reason: row.reason,
      triggerData,
      status: row.status,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
    };
  }
}

// ── Singleton export ────────────────────────────────────────

export const jobQueue: IJobQueue = new PrismaJobQueue();
