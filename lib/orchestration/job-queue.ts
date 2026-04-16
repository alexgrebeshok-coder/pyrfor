// Job Queue Abstraction
// MVP: simple DB-backed queue via AgentWakeupRequest
// Future: swap to BullMQ/Inngest without changing callers

import { prisma } from "@/lib/prisma";
import type { WakeupReason } from "./types";

export interface JobPayload {
  agentId: string;
  reason: WakeupReason;
  triggerData?: Record<string, unknown>;
}

export interface Job {
  id: string;
  agentId: string;
  reason: string;
  triggerData: Record<string, unknown>;
  status: string;
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
    // Coalescing: skip if identical job already queued for this agent
    const existing = await prisma.agentWakeupRequest.findFirst({
      where: {
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
        triggerData: payload.triggerData
          ? JSON.stringify(payload.triggerData)
          : "{}",
      },
    });
    return this.toJob(row);
  }

  async dequeueNext(): Promise<Job | null> {
    // Oldest queued request first (FIFO)
    const row = await prisma.agentWakeupRequest.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (!row) return null;

    // Mark as processing (optimistic lock via status check)
    const updated = await prisma.agentWakeupRequest.updateMany({
      where: { id: row.id, status: "queued" },
      data: { status: "processing", processedAt: new Date() },
    });
    if (updated.count === 0) return null; // someone else grabbed it

    return this.toJob({ ...row, status: "processing" });
  }

  async markDone(jobId: string): Promise<void> {
    await prisma.agentWakeupRequest.update({
      where: { id: jobId },
      data: { status: "done", processedAt: new Date() },
    });
  }

  async markFailed(jobId: string): Promise<void> {
    await prisma.agentWakeupRequest.update({
      where: { id: jobId },
      data: { status: "cancelled", processedAt: new Date() },
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
      createdAt: row.createdAt,
    };
  }
}

// ── Singleton export ────────────────────────────────────────

export const jobQueue: IJobQueue = new PrismaJobQueue();
